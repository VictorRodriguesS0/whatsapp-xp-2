// @vitest-environment node

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { verifyPassword } from "@/modules/auth/password";
import { resetTestDatabase } from "@/test/database";
import { DEMO_PASSWORD, seedDemoData } from "./seed";

describe("demonstration seed", () => {
  beforeEach(resetTestDatabase);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("can run twice without duplicating demonstration data", async () => {
    await seedDemoData(prisma);
    await seedDemoData(prisma);

    await expect(
      Promise.all([
        prisma.user.count(),
        prisma.contact.count(),
        prisma.conversation.count(),
        prisma.message.count(),
        prisma.mediaObject.count(),
        prisma.conversationRead.count(),
      ]),
    ).resolves.toEqual([3, 3, 3, 9, 3, 4]);

    const users = await prisma.user.findMany({ orderBy: { email: "asc" } });
    expect(users.map(({ name, role }) => ({ name, role }))).toEqual([
      { name: "João", role: "ATTENDANT" },
      { name: "Marcos", role: "ATTENDANT" },
      { name: "Victor", role: "ADMIN" },
    ]);
    expect(
      await verifyPassword(
        DEMO_PASSWORD,
        users.find((user) => user.name === "Victor")!.passwordHash,
      ),
    ).toBe(true);

    const conversations = await prisma.conversation.findMany({
      include: { contact: true, responsibleUser: true },
      orderBy: { contact: { name: "asc" } },
    });
    expect(
      conversations.map(({ contact, responsibleUser }) => [
        contact.name,
        responsibleUser?.name,
      ]),
    ).toEqual([
      ["Carlos", "Marcos"],
      ["Maria", "João"],
      ["Pedro", "Victor"],
    ]);

    const mediaMessages = await prisma.message.findMany({
      where: { mediaObjectId: { not: null } },
      orderBy: { type: "asc" },
    });
    expect(mediaMessages.map((message) => message.type)).toEqual([
      "IMAGE",
      "AUDIO",
      "DOCUMENT",
    ]);

    const carlosReads = await prisma.conversationRead.findMany({
      where: { conversationId: conversations[0]!.id },
      orderBy: { lastReadAt: "asc" },
    });
    expect(carlosReads).toHaveLength(2);
    expect(carlosReads[0]!.lastReadMessageId).not.toBe(
      carlosReads[1]!.lastReadMessageId,
    );

    const sharedState = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversations[0]!.id },
    });
    expect(sharedState).toMatchObject({
      teamLastReadMessageId: "00000000-0000-4000-8000-000000000302",
      teamLastReadAt: new Date("2026-08-18T14:13:00.000Z"),
      awaitingResponseSince: new Date("2026-08-18T14:12:00.000Z"),
    });
  });
});
