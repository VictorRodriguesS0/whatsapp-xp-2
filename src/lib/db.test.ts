// @vitest-environment node

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "./db";
import { resetTestDatabase, seedReadFixture } from "@/test/database";

describe("database", () => {
  beforeEach(resetTestDatabase);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("keeps one independent read state per user", async () => {
    const { conversation, victor, marcos } = await seedReadFixture();

    await prisma.conversationRead.createMany({
      data: [
        {
          conversationId: conversation.id,
          userId: victor.id,
          lastReadAt: new Date(1),
        },
        {
          conversationId: conversation.id,
          userId: marcos.id,
          lastReadAt: new Date(2),
        },
      ],
    });

    expect(
      await prisma.conversationRead.count({
        where: { conversationId: conversation.id },
      }),
    ).toBe(2);
  });

  it("refuses to reset a database that is not explicitly named as a test database", async () => {
    const testDatabaseUrl = process.env.DATABASE_URL;
    process.env.TEST_DATABASE_URL = testDatabaseUrl;
    process.env.DATABASE_URL =
      "postgresql://xp:xp@localhost:55432/xp_atendimento";

    try {
      await expect(resetTestDatabase()).rejects.toThrow(
        "Refusing to reset a non-test database",
      );
    } finally {
      process.env.DATABASE_URL = testDatabaseUrl;
    }
  });

  it("rejects an outbound message without a sending user", async () => {
    const { conversation } = await seedReadFixture();

    await expect(
      prisma.message.create({
        data: {
          conversationId: conversation.id,
          clientRequestId: "00000000-0000-4000-8000-000000000999",
          direction: "OUTBOUND",
          type: "TEXT",
          body: "Resposta sem remetente",
          status: "PENDING",
          externalTimestamp: new Date(),
        },
      }),
    ).rejects.toThrow();
  });
});
