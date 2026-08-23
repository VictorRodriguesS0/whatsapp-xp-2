// @vitest-environment node

import { describe, expect, it } from "vitest";

import { Prisma } from "@/generated/prisma/client";
import { UserRole } from "@/generated/prisma/enums";
import type { SessionUser } from "@/modules/auth/session";

import {
  contactTagIdsSchema,
  createContactDefinitionSchema,
  updateContactSchema,
} from "./schemas";
import {
  createContactTag,
  createContactType,
  deactivateContactTag,
  getContactTag,
  listActiveContactTypes,
  listActiveContactTags,
  listContactTags,
  normalizeContactDefinitionName,
  replaceContactTags,
  updateContact,
  updateContactType,
} from "./service";
import type {
  ContactRecord,
  ContactRepository,
  ContactTagAssignmentRecord,
  ContactUpdateData,
  DefinitionCreateData,
  DefinitionRecord,
  DefinitionUpdateData,
} from "./types";

const attendant: SessionUser & { active?: boolean } = {
  id: "d81c96d1-9a8d-4a4e-8dd6-729512c9cc47",
  name: "Marcos",
  email: "marcos@example.test",
  role: UserRole.ATTENDANT,
};
const admin = { ...attendant, role: UserRole.ADMIN };
const contactId = "06a86959-3b28-4ff5-84df-b2fc7665154d";
const typeId = "787ca5ba-eb3b-4ae6-b1f4-ddd6e92d2f84";
const tagId = "f697fbf1-10c6-4a06-a22f-2b742fcb1019";
const secondTagId = "dd810a5f-a822-46aa-98f0-e9023d47999b";

function definition(
  id: string,
  displayName: string,
  overrides: Partial<DefinitionRecord> = {},
): DefinitionRecord {
  return {
    id,
    displayName,
    normalizedName: normalizeContactDefinitionName(displayName),
    color: "#176B52",
    position: 10,
    active: true,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

function contact(overrides: Partial<ContactRecord> = {}): ContactRecord {
  return {
    id: contactId,
    name: "Nome Meta",
    preferredName: null,
    phone: "+5511999991234",
    contactTypeId: null,
    contactType: null,
    tagAssignments: [],
    ...overrides,
  };
}

function createRepository(options: {
  contact?: ContactRecord | null;
  types?: DefinitionRecord[];
  tags?: DefinitionRecord[];
  assignmentTagIds?: string[];
  failTagCreation?: boolean;
  transactionFailures?: unknown[];
  afterTransactionFailures?: Array<() => unknown>;
} = {}): ContactRepository & {
  listActiveContactTypes(): Promise<DefinitionRecord[]>;
  listActiveContactTags(): Promise<DefinitionRecord[]>;
  contactRecord: ContactRecord | null;
  typeRecords: DefinitionRecord[];
  tagRecords: DefinitionRecord[];
  assignmentTagIds: string[];
  contactUpdates: ContactUpdateData[];
  transactionAttempts: number;
} {
  let contactRecord: ContactRecord | null =
    options.contact === undefined ? contact() : options.contact;
  const typeRecords = (options.types ?? []).map((item) => ({ ...item }));
  const tagRecords = (options.tags ?? []).map((item) => ({ ...item }));
  const assignmentTagIds = [...(options.assignmentTagIds ?? [])];
  const contactUpdates: ContactUpdateData[] = [];
  const transactionFailures = [...(options.transactionFailures ?? [])];
  const afterTransactionFailures = [...(options.afterTransactionFailures ?? [])];
  let transactionAttempts = 0;

  const hydrateContact = (): ContactRecord | null => {
    if (!contactRecord) return null;
    return {
      ...contactRecord,
      contactType:
        typeRecords.find((item) => item.id === contactRecord?.contactTypeId) ?? null,
      tagAssignments: assignmentTagIds.flatMap((assignedTagId) => {
        const tag = tagRecords.find((item) => item.id === assignedTagId);
        return tag ? [{ tag }] : [];
      }),
    };
  };

  const repository: ContactRepository & {
    listActiveContactTypes(): Promise<DefinitionRecord[]>;
    listActiveContactTags(): Promise<DefinitionRecord[]>;
    contactRecord: ContactRecord | null;
    typeRecords: DefinitionRecord[];
    tagRecords: DefinitionRecord[];
    assignmentTagIds: string[];
    contactUpdates: ContactUpdateData[];
    transactionAttempts: number;
  } = {
    get contactRecord() {
      return hydrateContact();
    },
    set contactRecord(value) {
      contactRecord = value;
    },
    typeRecords,
    tagRecords,
    assignmentTagIds,
    contactUpdates,
    get transactionAttempts() {
      return transactionAttempts;
    },
    set transactionAttempts(value) {
      transactionAttempts = value;
    },
    isActorActive: async () => true,
    findContact: async (id) => (id === contactId ? hydrateContact() : null),
    updateContact: async (id, data) => {
      if (!contactRecord || id !== contactId) throw new Error("missing contact");
      contactUpdates.push({ ...data });
      contactRecord = { ...contactRecord, ...data };
      return hydrateContact()!;
    },
    listContactTypes: async () => typeRecords,
    listActiveContactTypes: async () =>
      typeRecords.filter((item) => item.active),
    findContactType: async (id) => typeRecords.find((item) => item.id === id) ?? null,
    createContactType: async (data: DefinitionCreateData) => {
      const created = definition(typeId, data.displayName, data);
      typeRecords.push(created);
      return created;
    },
    updateContactType: async (id, data: DefinitionUpdateData) => {
      const current = typeRecords.find((item) => item.id === id);
      if (!current) throw new Error("missing type");
      Object.assign(current, data, { updatedAt: new Date(1) });
      return current;
    },
    listContactTags: async () => tagRecords,
    listActiveContactTags: async () => tagRecords
      .filter((item) => item.active)
      .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id)),
    findContactTag: async (id) => tagRecords.find((item) => item.id === id) ?? null,
    findActiveContactTags: async (ids) =>
      tagRecords.filter((item) => ids.includes(item.id) && item.active),
    createContactTag: async (data: DefinitionCreateData) => {
      const created = definition(tagId, data.displayName, data);
      tagRecords.push(created);
      return created;
    },
    updateContactTag: async (id, data: DefinitionUpdateData) => {
      const current = tagRecords.find((item) => item.id === id);
      if (!current) throw new Error("missing tag");
      Object.assign(current, data, { updatedAt: new Date(1) });
      return current;
    },
    deleteContactTagAssignments: async (id) => {
      if (id === contactId) assignmentTagIds.splice(0, assignmentTagIds.length);
    },
    createContactTagAssignments: async (
      assignments: ContactTagAssignmentRecord[],
    ) => {
      if (options.failTagCreation) throw new Error("tag insertion failed");
      assignmentTagIds.push(...assignments.map((item) => item.tagId));
    },
    transaction: async (operation) => {
      transactionAttempts += 1;
      const failure = transactionFailures.shift();
      if (failure) throw failure;

      const staged = createRepository({
        contact: hydrateContact() ? { ...hydrateContact()! } : null,
        types: typeRecords,
        tags: tagRecords,
        assignmentTagIds,
        failTagCreation: options.failTagCreation,
      });
      staged.isActorActive = repository.isActorActive;
      const result = await operation(staged);
      const afterFailure = afterTransactionFailures.shift();
      if (afterFailure) throw afterFailure();
      contactRecord = staged.contactRecord;
      typeRecords.splice(0, typeRecords.length, ...staged.typeRecords);
      tagRecords.splice(0, tagRecords.length, ...staged.tagRecords);
      assignmentTagIds.splice(0, assignmentTagIds.length, ...staged.assignmentTagIds);
      contactUpdates.push(...staged.contactUpdates);
      return result;
    },
  };

  return repository;
}

function serializationFailure(): Error {
  return new Prisma.PrismaClientKnownRequestError("serialization failure", {
    code: "P2034",
    clientVersion: "test",
  });
}

describe("contact classification schemas", () => {
  it("trims a non-empty preferred name and accepts null only for removal", () => {
    expect(updateContactSchema.parse({ preferredName: "  Bia  " })).toEqual({
      preferredName: "Bia",
    });
    expect(updateContactSchema.parse({ preferredName: null })).toEqual({
      preferredName: null,
    });
    expect(() => updateContactSchema.parse({ preferredName: "   " })).toThrow();
  });

  it("requires uppercase colors, bounded integer positions, and strict UUIDs", () => {
    expect(
      createContactDefinitionSchema.parse({
        displayName: " Cliente ",
        color: "#A1B2C3",
        position: 10_000,
      }),
    ).toEqual({ displayName: "Cliente", color: "#A1B2C3", position: 10_000 });
    expect(() =>
      createContactDefinitionSchema.parse({
        displayName: "Cliente",
        color: "#a1b2c3",
        position: 1.5,
      }),
    ).toThrow();
    expect(() => updateContactSchema.parse({ contactTypeId: "not-a-uuid" })).toThrow();
  });

  it("accepts at most twenty unique strict tag UUIDs", () => {
    expect(contactTagIdsSchema.parse([tagId, secondTagId])).toEqual([
      tagId,
      secondTagId,
    ]);
    expect(contactTagIdsSchema.parse([tagId.toUpperCase()])).toEqual([tagId]);
    expect(() => contactTagIdsSchema.parse([tagId, tagId])).toThrow();
    expect(() =>
      contactTagIdsSchema.parse([tagId, tagId.toUpperCase()]),
    ).toThrow();
    expect(
      contactTagIdsSchema.parse(
        Array.from({ length: 20 }, (_, index) =>
          `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        ),
      ),
    ).toHaveLength(20);
    expect(() =>
      contactTagIdsSchema.parse(
        Array.from({ length: 21 }, (_, index) =>
          `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        ),
      ),
    ).toThrow();
  });
});

describe("contact classification service", () => {
  it("normalizes only uniqueness/search names with NFKC, pt-BR case folding, whitespace collapse, and diacritic removal", () => {
    expect(normalizeContactDefinitionName("  CAＦÉ\tPremium  ")).toBe(
      "cafe premium",
    );
  });

  it("lets an active attendant edit only preferred name and active type", async () => {
    const repository = createRepository({ types: [definition(typeId, "Cliente")] });

    const result = await updateContact(
      attendant,
      contactId,
      {
        preferredName: "  Bia  ",
        contactTypeId: typeId,
        name: "Nome adulterado",
        phone: "000",
        whatsappId: "provider-id",
      },
      repository,
    );

    expect(repository.contactUpdates).toEqual([
      { preferredName: "Bia", contactTypeId: typeId },
    ]);
    expect(result).toMatchObject({
      name: "Bia",
      phone: "+55 (11) 99999-1234",
      type: { id: typeId, name: "Cliente" },
    });
    expect(Object.keys(result).sort()).toEqual([
      "id",
      "name",
      "phone",
      "preferredName",
      "tags",
      "type",
      "whatsappAppName",
    ]);
    expect(result).not.toHaveProperty("profilePictureUrl");
    expect(result).not.toHaveProperty("profileName");
    expect(JSON.stringify(result)).not.toContain("normalizedName");
    expect(repository.contactRecord?.name).toBe("Nome Meta");
  });

  it("removes a preferred name explicitly with null", async () => {
    const repository = createRepository({
      contact: contact({ preferredName: "Bia" }),
    });

    await expect(
      updateContact(attendant, contactId, { preferredName: null }, repository),
    ).resolves.toMatchObject({ preferredName: null, name: "Nome Meta" });
  });

  it("maps a missing type to 404 and an inactive type to 400 before changing a contact", async () => {
    const missingRepository = createRepository();
    const inactiveRepository = createRepository({
      types: [definition(typeId, "Cliente", { active: false })],
    });

    await expect(
      updateContact(attendant, contactId, { contactTypeId: typeId }, missingRepository),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      updateContact(attendant, contactId, { contactTypeId: typeId }, inactiveRepository),
    ).rejects.toMatchObject({ status: 400 });
    expect(missingRepository.contactUpdates).toEqual([]);
    expect(inactiveRepository.contactUpdates).toEqual([]);
  });

  it("rejects explicitly inactive actors", async () => {
    const repository = createRepository();
    Object.assign(repository, { isActorActive: async () => false });

    await expect(
      updateContact(
        attendant,
        contactId,
        { preferredName: "Bia" },
        repository,
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(repository.contactUpdates).toEqual([]);
  });

  it("lists active contact types for an active attendant in repository order", async () => {
    const repository = createRepository({
      types: [
        definition(typeId, "Cliente", { position: 10, active: true }),
        definition("10000000-0000-4000-8000-000000000002", "Inativo", {
          position: 20,
          active: false,
        }),
      ],
    });

    await expect(listActiveContactTypes(attendant, repository)).resolves.toEqual([
      {
        id: typeId,
        displayName: "Cliente",
        color: "#176B52",
        position: 10,
        active: true,
      },
    ]);
  });

  it("rejects an inactive attendant before reading active contact types", async () => {
    let queried = false;
    const repository = createRepository();
    Object.assign(repository, {
      isActorActive: async () => false,
      listActiveContactTypes: async () => {
        queried = true;
        return [];
      },
    });

    await expect(listActiveContactTypes(attendant, repository)).rejects.toMatchObject({
      status: 403,
    });
    expect(queried).toBe(false);
  });

  it("lists only active labels for an active attendant in repository order", async () => {
    const first = definition(tagId, "Aguardando peça", { position: 10 });
    const second = definition(secondTagId, "VIP", { position: 20 });
    const repository = createRepository({
      tags: [second, definition("30000000-0000-4000-8000-000000000003", "Antiga", {
        active: false,
        position: 5,
      }), first],
    });

    await expect(listActiveContactTags(attendant, repository)).resolves.toEqual([
      { id: first.id, displayName: first.displayName, color: first.color, position: 10, active: true },
      { id: second.id, displayName: second.displayName, color: second.color, position: 20, active: true },
    ]);
  });

  it("rejects an inactive actor before reading active labels", async () => {
    const repository = createRepository({ tags: [definition(tagId, "VIP")] });
    let catalogReads = 0;
    repository.isActorActive = async () => false;
    repository.listActiveContactTags = async () => {
      catalogReads += 1;
      return repository.tagRecords;
    };

    await expect(listActiveContactTags(attendant, repository)).rejects.toMatchObject({
      status: 403,
    });
    expect(catalogReads).toBe(0);
  });

  it("maps missing tags to 404 and inactive tags to 400 before replacing assignments", async () => {
    const missingRepository = createRepository({
      tags: [definition(tagId, "VIP")],
      assignmentTagIds: [tagId],
    });
    const inactiveRepository = createRepository({
      tags: [
        definition(tagId, "VIP"),
        definition(secondTagId, "Retorno", { active: false }),
      ],
      assignmentTagIds: [tagId],
    });

    await expect(
      replaceContactTags(attendant, contactId, [secondTagId], missingRepository),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      replaceContactTags(attendant, contactId, [secondTagId], inactiveRepository),
    ).rejects.toMatchObject({ status: 400 });
    expect(missingRepository.assignmentTagIds).toEqual([tagId]);
    expect(inactiveRepository.assignmentTagIds).toEqual([tagId]);
  });

  it.each([
    [secondTagId, "30000000-0000-4000-8000-000000000003"],
    ["30000000-0000-4000-8000-000000000003", secondTagId],
  ])("maps a mixed inactive/missing tag set to 404 independent of order", async (...tagIds) => {
    const repository = createRepository({
      tags: [
        definition(tagId, "VIP"),
        definition(secondTagId, "Retorno", { active: false }),
      ],
      assignmentTagIds: [tagId],
    });

    await expect(
      replaceContactTags(attendant, contactId, tagIds, repository),
    ).rejects.toMatchObject({ status: 404 });
    expect(repository.assignmentTagIds).toEqual([tagId]);
  });

  it("rejects case-insensitive duplicate tag UUIDs before opening a transaction", async () => {
    const repository = createRepository({
      tags: [definition(tagId, "VIP")],
      assignmentTagIds: [tagId],
    });

    await expect(
      replaceContactTags(
        attendant,
        contactId,
        [tagId, tagId.toUpperCase()],
        repository,
      ),
    ).rejects.toMatchObject({ name: "ZodError" });
    expect(repository.transactionAttempts).toBe(0);
    expect(repository.assignmentTagIds).toEqual([tagId]);
  });

  it("replaces tags atomically, returns inactive existing tags, and is idempotent", async () => {
    const repository = createRepository({
      tags: [
        definition(tagId, "VIP"),
        definition(secondTagId, "Histórico", { active: false }),
      ],
      assignmentTagIds: [secondTagId],
    });

    const first = await replaceContactTags(
      attendant,
      contactId,
      [tagId.toUpperCase()],
      repository,
    );
    const second = await replaceContactTags(attendant, contactId, [tagId], repository);

    expect(repository.assignmentTagIds).toEqual([tagId]);
    expect(first.tags).toEqual([expect.objectContaining({ id: tagId })]);
    expect(second.tags).toEqual(first.tags);
  });

  it("rolls back deletion if tag insertion fails", async () => {
    const repository = createRepository({
      tags: [definition(tagId, "VIP"), definition(secondTagId, "Retorno")],
      assignmentTagIds: [tagId],
      failTagCreation: true,
    });

    await expect(
      replaceContactTags(attendant, contactId, [secondTagId], repository),
    ).rejects.toThrow("tag insertion failed");
    expect(repository.assignmentTagIds).toEqual([tagId]);
  });

  it("retries P2034 transaction conflicts with a bounded fresh transaction", async () => {
    const repository = createRepository({
      tags: [definition(tagId, "VIP")],
      transactionFailures: [serializationFailure(), serializationFailure()],
    });

    await expect(
      replaceContactTags(attendant, contactId, [tagId], repository),
    ).resolves.toMatchObject({ tags: [expect.objectContaining({ id: tagId })] });
    expect(repository.transactionAttempts).toBe(3);
  });

  it("rechecks actor activity inside a fresh retry before mutating tags", async () => {
    let actorActive = true;
    const repository = createRepository({
      tags: [definition(tagId, "VIP"), definition(secondTagId, "Retorno")],
      assignmentTagIds: [tagId],
      afterTransactionFailures: [() => {
        actorActive = false;
        return serializationFailure();
      }],
    });
    repository.isActorActive = async () => actorActive;

    await expect(
      replaceContactTags(attendant, contactId, [secondTagId], repository),
    ).rejects.toMatchObject({ status: 403 });
    expect(repository.transactionAttempts).toBe(2);
    expect(repository.assignmentTagIds).toEqual([tagId]);
  });

  it("allows only administrators to manage definitions", async () => {
    const repository = createRepository();
    const input = { displayName: "VIP", color: "#A1B2C3", position: 20 };

    await expect(createContactTag(attendant, input, repository)).rejects.toMatchObject({
      status: 403,
    });
    await expect(createContactTag(admin, input, repository)).resolves.toMatchObject({
      displayName: "VIP",
    });
  });

  it("preserves display spelling while rejecting normalized duplicates", async () => {
    const repository = createRepository({
      types: [definition(typeId, "Café Premium")],
    });

    await expect(
      createContactType(
        admin,
        { displayName: "  CAFE premium ", color: "#A1B2C3", position: 20 },
        repository,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(repository.typeRecords[0]?.displayName).toBe("Café Premium");
  });

  it("maps a database uniqueness race to a safe 409", async () => {
    const repository = createRepository();
    repository.createContactType = async () => {
      throw new Prisma.PrismaClientKnownRequestError("duplicate secret", {
        code: "P2002",
        clientVersion: "test",
      });
    };

    await expect(
      createContactType(
        admin,
        { displayName: "Cliente", color: "#A1B2C3", position: 20 },
        repository,
      ),
    ).rejects.toMatchObject({ status: 409, message: "Nome já cadastrado" });
  });

  it("updates ordering/color/name without exposing normalized names", async () => {
    const repository = createRepository({
      types: [definition(typeId, "Cliente")],
    });

    const result = await updateContactType(
      admin,
      typeId,
      { displayName: " Cliente Ouro ", color: "#A1B2C3", position: 30 },
      repository,
    );

    expect(result).toEqual({
      id: typeId,
      displayName: "Cliente Ouro",
      color: "#A1B2C3",
      position: 30,
      active: true,
    });
  });

  it("deactivates definitions without deleting them and keeps them readable", async () => {
    const repository = createRepository({ tags: [definition(tagId, "VIP")] });

    await deactivateContactTag(admin, tagId, repository);

    await expect(getContactTag(admin, tagId, repository)).resolves.toMatchObject({
      id: tagId,
      active: false,
    });
    await expect(listContactTags(admin, repository)).resolves.toEqual([
      expect.objectContaining({ id: tagId, active: false }),
    ]);
    expect(repository.tagRecords).toHaveLength(1);
  });
});
