import "server-only";

import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { formatContactPhone, resolveContactName } from "@/lib/contact-display";
import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { requireAdmin } from "@/modules/auth/guards";
import type { SessionUser } from "@/modules/auth/session";

import {
  contactDefinitionIdSchema,
  contactIdSchema,
  contactTagIdsSchema,
  createContactDefinitionSchema,
  updateContactDefinitionSchema,
  updateContactSchema,
  type CreateContactDefinitionInput,
  type UpdateContactDefinitionInput,
} from "./schemas";
import type {
  ContactClassificationDto,
  ContactDto,
  ContactRecord,
  ContactRepository,
  DefinitionCreateData,
  DefinitionDto,
  DefinitionRecord,
  DefinitionUpdateData,
} from "./types";

type ContactActor = SessionUser & { active?: boolean };
type PrismaContactRepositoryClient = Pick<
  PrismaClient,
  "contact" | "contactType" | "contactTagDefinition" | "contactTagAssignment"
>;

export type SerializableContactTransactionClient<TTransaction = undefined> = {
  $transaction<TResult>(
    operation: (transaction: TTransaction) => Promise<TResult>,
    options: { isolationLevel: Prisma.TransactionIsolationLevel },
  ): Promise<TResult>;
};

const definitionSelect = {
  id: true,
  displayName: true,
  normalizedName: true,
  color: true,
  position: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} as const;

const contactSelect = {
  id: true,
  name: true,
  preferredName: true,
  phone: true,
  profilePictureUrl: true,
  contactTypeId: true,
  contactType: { select: definitionSelect },
  tagAssignments: { select: { tag: { select: definitionSelect } } },
} as const;

function isPrismaError(error: unknown, code: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}

export async function runSerializableContactTransaction<
  TTransaction,
  TResult,
>(
  client: SerializableContactTransactionClient<TTransaction>,
  operation: (transaction: TTransaction) => Promise<TResult>,
): Promise<TResult> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await client.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (!isPrismaError(error, "P2034") || attempt === 2) throw error;
    }
  }

  throw new Error("Unreachable transaction state");
}

function createRepositoryForClient(
  client: PrismaContactRepositoryClient,
): ContactRepository {
  const repository: ContactRepository = {
    findContact: (id) =>
      client.contact.findUnique({ where: { id }, select: contactSelect }),
    updateContact: (id, data) =>
      client.contact.update({ where: { id }, data, select: contactSelect }),

    listContactTypes: () =>
      client.contactType.findMany({
        orderBy: [{ position: "asc" }, { id: "asc" }],
        select: definitionSelect,
      }),
    findContactType: (id) =>
      client.contactType.findUnique({ where: { id }, select: definitionSelect }),
    createContactType: (data) =>
      client.contactType.create({ data, select: definitionSelect }),
    updateContactType: (id, data) =>
      client.contactType.update({ where: { id }, data, select: definitionSelect }),

    listContactTags: () =>
      client.contactTagDefinition.findMany({
        orderBy: [{ position: "asc" }, { id: "asc" }],
        select: definitionSelect,
      }),
    findContactTag: (id) =>
      client.contactTagDefinition.findUnique({
        where: { id },
        select: definitionSelect,
      }),
    findActiveContactTags: (ids) =>
      client.contactTagDefinition.findMany({
        where: { id: { in: ids }, active: true },
        select: definitionSelect,
      }),
    createContactTag: (data) =>
      client.contactTagDefinition.create({ data, select: definitionSelect }),
    updateContactTag: (id, data) =>
      client.contactTagDefinition.update({
        where: { id },
        data,
        select: definitionSelect,
      }),

    deleteContactTagAssignments: async (contactId) => {
      await client.contactTagAssignment.deleteMany({ where: { contactId } });
    },
    createContactTagAssignments: async (assignments) => {
      if (assignments.length > 0) {
        await client.contactTagAssignment.createMany({ data: assignments });
      }
    },
    transaction: async (operation) => operation(repository),
  };

  return repository;
}

export function createPrismaContactRepository(
  client: PrismaClient,
): ContactRepository {
  const repository = createRepositoryForClient(client);
  repository.transaction = (operation) =>
    client.$transaction(
      (transaction) => operation(createRepositoryForClient(transaction)),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  return repository;
}

const contactRepository = createPrismaContactRepository(prisma);

export function normalizeContactDefinitionName(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("pt-BR")
    .trim()
    .replace(/\s+/gu, " ")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .normalize("NFC");
}

function toDefinitionDto({
  id,
  displayName,
  color,
  position,
  active,
}: DefinitionRecord): DefinitionDto {
  return { id, displayName, color, position, active };
}

function toContactClassificationDto({
  id,
  displayName,
  color,
  active,
}: DefinitionRecord): ContactClassificationDto {
  return { id, name: displayName, color, active };
}

function toContactDto(contact: ContactRecord): ContactDto {
  return {
    id: contact.id,
    profileName: contact.name,
    preferredName: contact.preferredName,
    name: resolveContactName({
      preferredName: contact.preferredName,
      profileName: contact.name,
      phone: contact.phone,
    }),
    phone: formatContactPhone(contact.phone),
    type: contact.contactType
      ? toContactClassificationDto(contact.contactType)
      : null,
    tags: contact.tagAssignments
      .map(({ tag }) => ({
        dto: toContactClassificationDto(tag),
        position: tag.position,
      }))
      .sort(
        (left, right) =>
          left.position - right.position ||
          left.dto.id.localeCompare(right.dto.id),
      )
      .map(({ dto }) => dto),
  };
}

function requireActiveActor(actor: ContactActor): void {
  if (actor.active === false) throw new HttpError(403, "Acesso negado");
}

async function requireActiveAdmin(actor: ContactActor): Promise<void> {
  requireActiveActor(actor);
  await requireAdmin(async () => actor);
}

function rethrowDefinitionDatabaseError(error: unknown): never {
  if (isPrismaError(error, "P2002")) {
    throw new HttpError(409, "Nome já cadastrado");
  }
  throw error;
}

async function runContactRepositoryTransaction<T>(
  repository: ContactRepository,
  operation: (transaction: ContactRepository) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await repository.transaction(operation);
    } catch (error) {
      if (!isPrismaError(error, "P2034") || attempt === 2) throw error;
    }
  }

  throw new Error("Unreachable transaction state");
}

async function requireContact(
  id: string,
  repository: ContactRepository,
): Promise<ContactRecord> {
  const contact = await repository.findContact(id);
  if (!contact) throw new HttpError(404, "Contato não encontrado");
  return contact;
}

async function ensureUniqueDefinitionName(
  displayName: string,
  list: () => Promise<DefinitionRecord[]>,
  currentId?: string,
): Promise<string> {
  const normalizedName = normalizeContactDefinitionName(displayName);
  const duplicate = (await list()).some(
    (definition) =>
      definition.id !== currentId &&
      normalizeContactDefinitionName(definition.displayName) === normalizedName,
  );
  if (duplicate) throw new HttpError(409, "Nome já cadastrado");
  return normalizedName;
}

export async function updateContact(
  actor: ContactActor,
  contactId: string,
  input: unknown,
  repository: ContactRepository = contactRepository,
): Promise<ContactDto> {
  requireActiveActor(actor);
  const parsedId = contactIdSchema.parse(contactId);
  const parsed = updateContactSchema.parse(input);
  await requireContact(parsedId, repository);

  if (parsed.contactTypeId) {
    const contactType = await repository.findContactType(parsed.contactTypeId);
    if (!contactType || !contactType.active) {
      throw new HttpError(409, "Tipo de contato indisponível");
    }
  }

  return toContactDto(await repository.updateContact(parsedId, parsed));
}

export async function replaceContactTags(
  actor: ContactActor,
  contactId: string,
  tagIds: unknown,
  repository: ContactRepository = contactRepository,
): Promise<ContactDto> {
  requireActiveActor(actor);
  const parsedContactId = contactIdSchema.parse(contactId);
  const parsedTagIds = contactTagIdsSchema.parse(tagIds);

  return runContactRepositoryTransaction(repository, async (transaction) => {
    const currentContact = await requireContact(parsedContactId, transaction);
    const activeTags = await transaction.findActiveContactTags(parsedTagIds);
    if (activeTags.length !== parsedTagIds.length) {
      throw new HttpError(409, "Etiqueta indisponível");
    }

    const currentTagIds = currentContact.tagAssignments
      .map(({ tag }) => tag.id)
      .sort();
    const requestedTagIds = [...parsedTagIds].sort();
    if (
      currentTagIds.length === requestedTagIds.length &&
      currentTagIds.every((tagId, index) => tagId === requestedTagIds[index])
    ) {
      return toContactDto(currentContact);
    }

    await transaction.deleteContactTagAssignments(parsedContactId);
    await transaction.createContactTagAssignments(
      parsedTagIds.map((tagId) => ({ contactId: parsedContactId, tagId })),
    );

    return toContactDto(await requireContact(parsedContactId, transaction));
  });
}

type DefinitionOperations = {
  list(repository: ContactRepository): Promise<DefinitionRecord[]>;
  find(repository: ContactRepository, id: string): Promise<DefinitionRecord | null>;
  create(
    repository: ContactRepository,
    data: DefinitionCreateData,
  ): Promise<DefinitionRecord>;
  update(
    repository: ContactRepository,
    id: string,
    data: DefinitionUpdateData,
  ): Promise<DefinitionRecord>;
  notFoundMessage: string;
};

const contactTypeOperations: DefinitionOperations = {
  list: (repository) => repository.listContactTypes(),
  find: (repository, id) => repository.findContactType(id),
  create: (repository, data) => repository.createContactType(data),
  update: (repository, id, data) => repository.updateContactType(id, data),
  notFoundMessage: "Tipo de contato não encontrado",
};

const contactTagOperations: DefinitionOperations = {
  list: (repository) => repository.listContactTags(),
  find: (repository, id) => repository.findContactTag(id),
  create: (repository, data) => repository.createContactTag(data),
  update: (repository, id, data) => repository.updateContactTag(id, data),
  notFoundMessage: "Etiqueta não encontrada",
};

async function listDefinitions(
  actor: ContactActor,
  operations: DefinitionOperations,
  repository: ContactRepository,
): Promise<DefinitionDto[]> {
  await requireActiveAdmin(actor);
  return (await operations.list(repository)).map(toDefinitionDto);
}

async function getDefinition(
  actor: ContactActor,
  id: string,
  operations: DefinitionOperations,
  repository: ContactRepository,
): Promise<DefinitionDto> {
  await requireActiveAdmin(actor);
  const parsedId = contactDefinitionIdSchema.parse(id);
  const definition = await operations.find(repository, parsedId);
  if (!definition) throw new HttpError(404, operations.notFoundMessage);
  return toDefinitionDto(definition);
}

async function createDefinition(
  actor: ContactActor,
  input: unknown,
  operations: DefinitionOperations,
  repository: ContactRepository,
): Promise<DefinitionDto> {
  await requireActiveAdmin(actor);
  const parsed: CreateContactDefinitionInput =
    createContactDefinitionSchema.parse(input);
  const normalizedName = await ensureUniqueDefinitionName(
    parsed.displayName,
    () => operations.list(repository),
  );
  try {
    return toDefinitionDto(
      await operations.create(repository, { ...parsed, normalizedName }),
    );
  } catch (error) {
    return rethrowDefinitionDatabaseError(error);
  }
}

async function updateDefinition(
  actor: ContactActor,
  id: string,
  input: unknown,
  operations: DefinitionOperations,
  repository: ContactRepository,
): Promise<DefinitionDto> {
  await requireActiveAdmin(actor);
  const parsedId = contactDefinitionIdSchema.parse(id);
  const parsed: UpdateContactDefinitionInput =
    updateContactDefinitionSchema.parse(input);
  if (!(await operations.find(repository, parsedId))) {
    throw new HttpError(404, operations.notFoundMessage);
  }

  const data: DefinitionUpdateData = { ...parsed };
  if (parsed.displayName !== undefined) {
    data.normalizedName = await ensureUniqueDefinitionName(
      parsed.displayName,
      () => operations.list(repository),
      parsedId,
    );
  }

  try {
    return toDefinitionDto(await operations.update(repository, parsedId, data));
  } catch (error) {
    return rethrowDefinitionDatabaseError(error);
  }
}

async function deactivateDefinition(
  actor: ContactActor,
  id: string,
  operations: DefinitionOperations,
  repository: ContactRepository,
): Promise<DefinitionDto> {
  await requireActiveAdmin(actor);
  const parsedId = contactDefinitionIdSchema.parse(id);
  if (!(await operations.find(repository, parsedId))) {
    throw new HttpError(404, operations.notFoundMessage);
  }
  return toDefinitionDto(
    await operations.update(repository, parsedId, { active: false }),
  );
}

export const listContactTypes = (
  actor: ContactActor,
  repository: ContactRepository = contactRepository,
) => listDefinitions(actor, contactTypeOperations, repository);
export const getContactType = (
  actor: ContactActor,
  id: string,
  repository: ContactRepository = contactRepository,
) => getDefinition(actor, id, contactTypeOperations, repository);
export const createContactType = (
  actor: ContactActor,
  input: unknown,
  repository: ContactRepository = contactRepository,
) => createDefinition(actor, input, contactTypeOperations, repository);
export const updateContactType = (
  actor: ContactActor,
  id: string,
  input: unknown,
  repository: ContactRepository = contactRepository,
) => updateDefinition(actor, id, input, contactTypeOperations, repository);
export const deactivateContactType = (
  actor: ContactActor,
  id: string,
  repository: ContactRepository = contactRepository,
) => deactivateDefinition(actor, id, contactTypeOperations, repository);

export const listContactTags = (
  actor: ContactActor,
  repository: ContactRepository = contactRepository,
) => listDefinitions(actor, contactTagOperations, repository);
export const getContactTag = (
  actor: ContactActor,
  id: string,
  repository: ContactRepository = contactRepository,
) => getDefinition(actor, id, contactTagOperations, repository);
export const createContactTag = (
  actor: ContactActor,
  input: unknown,
  repository: ContactRepository = contactRepository,
) => createDefinition(actor, input, contactTagOperations, repository);
export const updateContactTag = (
  actor: ContactActor,
  id: string,
  input: unknown,
  repository: ContactRepository = contactRepository,
) => updateDefinition(actor, id, input, contactTagOperations, repository);
export const deactivateContactTag = (
  actor: ContactActor,
  id: string,
  repository: ContactRepository = contactRepository,
) => deactivateDefinition(actor, id, contactTagOperations, repository);
