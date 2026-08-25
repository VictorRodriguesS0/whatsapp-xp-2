import "server-only";

import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import {
  ContactMessagingConsentAction,
  ContactMessagingRestrictionAction,
} from "@/generated/prisma/enums";
import { formatContactPhone, resolveContactName } from "@/lib/contact-display";
import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { requireAdmin } from "@/modules/auth/guards";
import type { SessionUser } from "@/modules/auth/session";

import {
  contactDefinitionIdSchema,
  contactIdSchema,
  contactMessagingConsentSchema,
  contactMessagingRestrictionSchema,
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
  ContactMessagingConsentDto,
  ContactMessagingConsentServiceDependencies,
  ContactMessagingRestrictionDto,
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
  | "user"
  | "contact"
  | "contactType"
  | "contactTagDefinition"
  | "contactTagAssignment"
  | "contactMessagingConsentEvent"
  | "contactMessagingRestrictionEvent"
  | "$queryRaw"
>;

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
  whatsappAppContact: { select: { fullName: true, active: true } },
  messagingOptOutAt: true,
  messagingConsentGrantedAt: true,
  messagingConsentSource: true,
  messagingConsentGrantedByUserId: true,
  messagingConsentGrantedByUser: { select: { id: true, name: true } },
  messagingConsentNote: true,
  contactTypeId: true,
  contactType: { select: definitionSelect },
  tagAssignments: { select: { tag: { select: definitionSelect } } },
} as const;

function isPrismaError(error: unknown, code: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}

function isSerializationFailure(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === "P2034") return true;
  if (error.code !== "P2010") return false;

  const driverAdapterError = error.meta?.driverAdapterError;
  if (!driverAdapterError || typeof driverAdapterError !== "object") return false;
  const cause = Reflect.get(driverAdapterError, "cause");
  return (
    cause !== null &&
    typeof cause === "object" &&
    Reflect.get(cause, "originalCode") === "40001"
  );
}

function createRepositoryForClient(
  client: PrismaContactRepositoryClient,
): ContactRepository {
  const repository: ContactRepository = {
    isActorActive: async (id) =>
      (await client.user.count({ where: { id, active: true } })) === 1,
    findContact: (id) =>
      client.contact.findUnique({ where: { id }, select: contactSelect }),
    updateContact: (id, data) =>
      client.contact.update({ where: { id }, data, select: contactSelect }),
    lockContactForMessagingRestriction: async (id) => {
      const locked = await client.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT id FROM contacts WHERE id = ${id}::uuid FOR UPDATE`,
      );
      if (locked.length === 0) return null;
      return client.contact.findUnique({ where: { id }, select: contactSelect });
    },
    updateContactMessagingRestriction: (id, data) =>
      client.contact.update({ where: { id }, data, select: contactSelect }),
    createContactMessagingRestrictionEvent: async (data) => {
      await client.contactMessagingRestrictionEvent.create({ data });
    },
    lockContactForMessagingConsent: async (id) => {
      const locked = await client.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT id FROM contacts WHERE id = ${id}::uuid FOR UPDATE`,
      );
      if (locked.length === 0) return null;
      return client.contact.findUnique({ where: { id }, select: contactSelect });
    },
    updateContactMessagingConsent: (id, data) =>
      client.contact.update({ where: { id }, data, select: contactSelect }),
    createContactMessagingConsentEvent: async (data) => {
      await client.contactMessagingConsentEvent.create({ data });
    },

    listContactTypes: () =>
      client.contactType.findMany({
        orderBy: [{ position: "asc" }, { id: "asc" }],
        select: definitionSelect,
      }),
    listActiveContactTypes: () =>
      client.contactType.findMany({
        where: { active: true },
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
    listActiveContactTags: () =>
      client.contactTagDefinition.findMany({
        where: { active: true },
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
const contactMessagingConsentDependencies: ContactMessagingConsentServiceDependencies = {
  repository: contactRepository,
  now: () => new Date(),
};

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
    preferredName: contact.preferredName,
    whatsappAppName:
      contact.whatsappAppContact?.active === true
        ? contact.whatsappAppContact.fullName
        : null,
    name: resolveContactName({
      preferredName: contact.preferredName,
      whatsappAppName:
        contact.whatsappAppContact?.active === true
          ? contact.whatsappAppContact.fullName
          : null,
      profileName: contact.name,
      phone: contact.phone,
    }),
    phone: formatContactPhone(contact.phone),
    messagingRestricted: contact.messagingOptOutAt !== null,
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

async function requireActiveActor(
  actor: ContactActor,
  repository: ContactRepository,
): Promise<void> {
  if (!(await repository.isActorActive(actor.id))) {
    throw new HttpError(403, "Acesso negado");
  }
}

async function requireActiveAdmin(
  actor: ContactActor,
  repository: ContactRepository,
): Promise<void> {
  await requireActiveActor(actor, repository);
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
      if (!isSerializationFailure(error) || attempt === 2) throw error;
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
  await requireActiveActor(actor, repository);
  const parsedId = contactIdSchema.parse(contactId);
  const parsed = updateContactSchema.parse(input);
  await requireContact(parsedId, repository);

  if (parsed.contactTypeId) {
    const contactType = await repository.findContactType(parsed.contactTypeId);
    if (!contactType) throw new HttpError(404, "Tipo de contato não encontrado");
    if (!contactType.active) throw new HttpError(400, "Tipo de contato indisponível");
  }

  return toContactDto(await repository.updateContact(parsedId, parsed));
}

function toContactMessagingConsentDto(
  contact: ContactRecord,
): ContactMessagingConsentDto {
  const active = contact.messagingConsentGrantedAt !== null;
  if (!active) {
    return {
      active: false,
      source: null,
      grantedAt: null,
      grantedBy: null,
      note: null,
    };
  }

  return {
    active: true,
    source: contact.messagingConsentSource,
    grantedAt: contact.messagingConsentGrantedAt?.toISOString() ?? null,
    grantedBy: contact.messagingConsentGrantedByUser,
    note: contact.messagingConsentNote,
  };
}

export async function setContactMessagingRestriction(
  actor: ContactActor,
  contactId: string,
  input: unknown,
  repository: ContactRepository = contactRepository,
): Promise<ContactMessagingRestrictionDto> {
  const parsedContactId = contactIdSchema.parse(contactId);
  const parsed = contactMessagingRestrictionSchema.parse(input);

  return runContactRepositoryTransaction(repository, async (transaction) => {
    const current = await transaction.lockContactForMessagingRestriction(
      parsedContactId,
    );
    if (!current) throw new HttpError(404, "Contato não encontrado");
    await requireActiveActor(actor, transaction);

    const currentlyRestricted = current.messagingOptOutAt !== null;
    if (currentlyRestricted === parsed.restricted) {
      return { messagingRestricted: currentlyRestricted };
    }

    if (parsed.restricted && current.messagingConsentGrantedAt !== null) {
      const source = current.messagingConsentSource;
      if (!source) {
        throw new Error("Active messaging consent is missing its source");
      }
      await transaction.updateContactMessagingConsent(parsedContactId, {
        messagingConsentGrantedAt: null,
        messagingConsentSource: null,
        messagingConsentGrantedByUserId: null,
        messagingConsentNote: null,
      });
      await transaction.createContactMessagingConsentEvent({
        contactId: parsedContactId,
        actorUserId: actor.id,
        action: ContactMessagingConsentAction.REVOKED,
        source,
        note: current.messagingConsentNote,
      });
    }

    const updated = await transaction.updateContactMessagingRestriction(
      parsedContactId,
      parsed.restricted
        ? {
            messagingOptOutAt: new Date(),
            messagingRestrictionReason: parsed.reason,
            messagingRestrictedByUserId: actor.id,
          }
        : {
            messagingOptOutAt: null,
            messagingRestrictionReason: null,
            messagingRestrictedByUserId: null,
          },
    );
    await transaction.createContactMessagingRestrictionEvent({
      contactId: parsedContactId,
      actorUserId: actor.id,
      action: parsed.restricted
        ? ContactMessagingRestrictionAction.OPT_OUT
        : ContactMessagingRestrictionAction.OPT_IN,
      reason: parsed.reason,
    });

    return { messagingRestricted: updated.messagingOptOutAt !== null };
  });
}

export async function setContactMessagingConsent(
  actor: ContactActor,
  contactId: string,
  input: unknown,
  dependencies: ContactMessagingConsentServiceDependencies =
    contactMessagingConsentDependencies,
): Promise<ContactMessagingConsentDto> {
  const parsedContactId = contactIdSchema.parse(contactId);
  const parsed = contactMessagingConsentSchema.parse(input);

  return runContactRepositoryTransaction(
    dependencies.repository,
    async (transaction) => {
      const current = await transaction.lockContactForMessagingConsent(
        parsedContactId,
      );
      if (!current) throw new HttpError(404, "Contato não encontrado");
      await requireActiveActor(actor, transaction);

      if (parsed.action === "GRANT") {
        if (current.messagingOptOutAt !== null) {
          throw new HttpError(
            409,
            "Este contato está marcado como não contatar.",
            "WHATSAPP_CONTACT_OPTED_OUT",
          );
        }

        const note = parsed.note ?? null;
        const isIdenticalGrant =
          current.messagingConsentGrantedAt !== null &&
          current.messagingConsentSource === parsed.source &&
          current.messagingConsentNote === note;
        if (isIdenticalGrant) return toContactMessagingConsentDto(current);

        const updated = await transaction.updateContactMessagingConsent(
          parsedContactId,
          {
            messagingConsentGrantedAt: dependencies.now(),
            messagingConsentSource: parsed.source,
            messagingConsentGrantedByUserId: actor.id,
            messagingConsentNote: note,
          },
        );
        await transaction.createContactMessagingConsentEvent({
          contactId: parsedContactId,
          actorUserId: actor.id,
          action: ContactMessagingConsentAction.GRANTED,
          source: parsed.source,
          note,
        });
        return toContactMessagingConsentDto(updated);
      }

      if (current.messagingConsentGrantedAt === null) {
        return toContactMessagingConsentDto(current);
      }
      const source = current.messagingConsentSource;
      if (!source) {
        throw new Error("Active messaging consent is missing its source");
      }

      const updated = await transaction.updateContactMessagingConsent(
        parsedContactId,
        {
          messagingConsentGrantedAt: null,
          messagingConsentSource: null,
          messagingConsentGrantedByUserId: null,
          messagingConsentNote: null,
        },
      );
      await transaction.createContactMessagingConsentEvent({
        contactId: parsedContactId,
        actorUserId: actor.id,
        action: ContactMessagingConsentAction.REVOKED,
        source,
        note: current.messagingConsentNote,
      });
      return toContactMessagingConsentDto(updated);
    },
  );
}

export async function replaceContactTags(
  actor: ContactActor,
  contactId: string,
  tagIds: unknown,
  repository: ContactRepository = contactRepository,
): Promise<ContactDto> {
  const parsedContactId = contactIdSchema.parse(contactId);
  const parsedTagIds = contactTagIdsSchema.parse(tagIds);

  return runContactRepositoryTransaction(repository, async (transaction) => {
    await requireActiveActor(actor, transaction);
    const currentContact = await requireContact(parsedContactId, transaction);
    const activeTags = await transaction.findActiveContactTags(parsedTagIds);
    if (activeTags.length !== parsedTagIds.length) {
      const activeTagIds = new Set(activeTags.map(({ id }) => id));
      const unavailableIds = parsedTagIds.filter((id) => !activeTagIds.has(id));
      for (const unavailableId of unavailableIds) {
        if (!(await transaction.findContactTag(unavailableId))) {
          throw new HttpError(404, "Etiqueta não encontrada");
        }
      }
      throw new HttpError(400, "Etiqueta indisponível");
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
  await requireActiveAdmin(actor, repository);
  return (await operations.list(repository)).map(toDefinitionDto);
}

async function getDefinition(
  actor: ContactActor,
  id: string,
  operations: DefinitionOperations,
  repository: ContactRepository,
): Promise<DefinitionDto> {
  await requireActiveAdmin(actor, repository);
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
  await requireActiveAdmin(actor, repository);
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
  await requireActiveAdmin(actor, repository);
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
  await requireActiveAdmin(actor, repository);
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
export async function listActiveContactTypes(
  actor: ContactActor,
  repository: ContactRepository = contactRepository,
): Promise<DefinitionDto[]> {
  await requireActiveActor(actor, repository);
  return (await repository.listActiveContactTypes()).map(toDefinitionDto);
}

export const listContactTags = (
  actor: ContactActor,
  repository: ContactRepository = contactRepository,
) => listDefinitions(actor, contactTagOperations, repository);
export async function listActiveContactTags(
  actor: ContactActor,
  repository: ContactRepository = contactRepository,
): Promise<DefinitionDto[]> {
  await requireActiveActor(actor, repository);
  return (await repository.listActiveContactTags()).map(toDefinitionDto);
}
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
