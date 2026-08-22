// @vitest-environment node

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { UserRole } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { resetTestDatabase } from "@/test/database";

import {
  createContactTag,
  createContactType,
  createPrismaContactRepository,
  replaceContactTags,
  updateContact,
} from "./service";
import type { ContactRepository } from "./types";

const admin = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Victor",
  email: "victor.contacts@example.test",
  role: UserRole.ADMIN,
};

function deterministicBarrier(participants: number): () => Promise<void> {
  let arrivals = 0;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });

  return async () => {
    arrivals += 1;
    if (arrivals === participants) release();
    await ready;
  };
}

async function resetClassificationDatabase(): Promise<void> {
  await resetTestDatabase();
  await prisma.contactTagDefinition.deleteMany();
  await prisma.contactType.deleteMany();
}

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "contact classification PostgreSQL repository",
  () => {
    beforeAll(async () => {
      const [database] = await prisma.$queryRaw<
        Array<{ database: string; server_version_num: string }>
      >`SELECT current_database() AS database, current_setting('server_version_num') AS server_version_num`;
      expect(database?.database.endsWith("_test")).toBe(true);
      expect(Number(database?.server_version_num)).toBeGreaterThanOrEqual(180_000);
      expect(Number(database?.server_version_num)).toBeLessThan(190_000);
    });

    beforeEach(resetClassificationDatabase);

    afterAll(async () => {
      await prisma.$disconnect();
    });

    it("maps two administrators racing to create canonically equivalent names to one success and one safe 409", async () => {
      await prisma.user.create({
        data: { ...admin, passwordHash: "not-used" },
      });
      const baseRepository = createPrismaContactRepository(prisma);
      const barrier = deterministicBarrier(2);
      const withReadBarrier = (): ContactRepository => ({
        ...baseRepository,
        listContactTypes: async () => {
          const records = await baseRepository.listContactTypes();
          await barrier();
          return records;
        },
      });

      const outcomes = await Promise.allSettled([
        createContactType(
          admin,
          { displayName: "Café Premium", color: "#176B52", position: 10 },
          withReadBarrier(),
        ),
        createContactType(
          admin,
          { displayName: "ＣＡＦＥ́   premium", color: "#2563EB", position: 20 },
          withReadBarrier(),
        ),
      ]);

      expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
      const rejected = outcomes.find((outcome) => outcome.status === "rejected");
      expect(rejected).toMatchObject({
        status: "rejected",
        reason: { status: 409, message: "Nome já cadastrado" },
      });
      await expect(prisma.contactType.count()).resolves.toBe(1);
    });

    it("keeps the old tag set when any requested tag is inactive", async () => {
      const actor = await prisma.user.create({
        data: {
          ...admin,
          passwordHash: "not-used",
        },
      });
      const contact = await prisma.contact.create({
        data: { name: "Contato Meta", phone: `+55${Date.now()}` },
      });
      const active = await createContactTag(actor, {
        displayName: `VIP ${randomUUID()}`,
        color: "#176B52",
        position: 10,
      });
      const inactive = await prisma.contactTagDefinition.create({
        data: {
          displayName: `Inativa ${randomUUID()}`,
          normalizedName: `inativa-${randomUUID()}`,
          color: "#6D746F",
          position: 20,
          active: false,
        },
      });
      await prisma.contactTagAssignment.create({
        data: { contactId: contact.id, tagId: active.id },
      });

      await expect(
        replaceContactTags(actor, contact.id, [inactive.id]),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        prisma.contactTagAssignment.findMany({ where: { contactId: contact.id } }),
      ).resolves.toEqual([
        expect.objectContaining({ contactId: contact.id, tagId: active.id }),
      ]);
    });

    it("rejects an actor whose authoritative user row is inactive", async () => {
      const actor = await prisma.user.create({
        data: {
          ...admin,
          active: false,
          passwordHash: "not-used",
        },
      });
      const contact = await prisma.contact.create({
        data: { name: "Contato Meta", phone: `+55${Date.now()}` },
      });

      await expect(
        updateContact(actor, contact.id, { preferredName: "Bia" }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        prisma.contact.findUniqueOrThrow({
          where: { id: contact.id },
          select: { preferredName: true },
        }),
      ).resolves.toEqual({ preferredName: null });
    });

    it("replacing the same tag set repeatedly stays unique and readable after deactivation", async () => {
      const actor = await prisma.user.create({
        data: {
          ...admin,
          passwordHash: "not-used",
        },
      });
      const contact = await prisma.contact.create({
        data: { name: "Contato Meta", phone: `+55${Date.now()}` },
      });
      const tag = await createContactTag(actor, {
        displayName: `Retorno ${randomUUID()}`,
        color: "#176B52",
        position: 10,
      });

      await replaceContactTags(actor, contact.id, [tag.id]);
      const originalCreatedAt = new Date("2020-01-01T00:00:00.000Z");
      await prisma.contactTagAssignment.update({
        where: { contactId_tagId: { contactId: contact.id, tagId: tag.id } },
        data: { createdAt: originalCreatedAt },
      });
      await replaceContactTags(actor, contact.id, [tag.id]);
      await prisma.contactTagDefinition.update({
        where: { id: tag.id },
        data: { active: false },
      });

      const repository = createPrismaContactRepository(prisma);
      const stored = await repository.findContact(contact.id);
      expect(stored?.tagAssignments).toEqual([
        expect.objectContaining({ tag: expect.objectContaining({ id: tag.id, active: false }) }),
      ]);
      await expect(
        prisma.contactTagAssignment.findMany({ where: { contactId: contact.id } }),
      ).resolves.toEqual([
        expect.objectContaining({
          contactId: contact.id,
          tagId: tag.id,
          createdAt: originalCreatedAt,
        }),
      ]);
    });

    it("retries concurrent replace-set transactions without committing an empty or union set", async () => {
      const actor = await prisma.user.create({
        data: { ...admin, passwordHash: "not-used" },
      });
      const contact = await prisma.contact.create({
        data: { name: "Contato Meta", phone: `+55${Date.now()}` },
      });
      const [oldTag, firstTag, secondTag] = await Promise.all(
        ["Antiga", "Primeira", "Segunda"].map((displayName, position) =>
          prisma.contactTagDefinition.create({
            data: {
              displayName,
              normalizedName: `${displayName.toLowerCase()}-${randomUUID()}`,
              color: "#176B52",
              position,
            },
          }),
        ),
      );
      await prisma.contactTagAssignment.create({
        data: { contactId: contact.id, tagId: oldTag.id },
      });

      const baseRepository = createPrismaContactRepository(prisma);
      const barrier = deterministicBarrier(2);
      let transactionAttempts = 0;
      const racingRepository: ContactRepository = {
        ...baseRepository,
        transaction: (operation) => {
          transactionAttempts += 1;
          return baseRepository.transaction(async (transaction) => {
            let firstContactRead = true;
            return operation({
              ...transaction,
              findContact: async (id) => {
                const record = await transaction.findContact(id);
                if (firstContactRead) {
                  firstContactRead = false;
                  await barrier();
                }
                return record;
              },
            });
          });
        },
      };

      const outcomes = await Promise.all([
        replaceContactTags(actor, contact.id, [firstTag.id], racingRepository),
        replaceContactTags(actor, contact.id, [secondTag.id], racingRepository),
      ]);
      expect(outcomes).toHaveLength(2);
      expect(transactionAttempts).toBeGreaterThanOrEqual(3);

      const storedTagIds = (
        await prisma.contactTagAssignment.findMany({
          where: { contactId: contact.id },
          select: { tagId: true },
        })
      ).map(({ tagId }) => tagId);
      expect([[firstTag.id], [secondTag.id]]).toContainEqual(storedTagIds);
    });
  },
);
