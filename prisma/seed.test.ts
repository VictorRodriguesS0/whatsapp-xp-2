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

    const carlosMessages = await prisma.message.findMany({
      where: { conversationId: conversations[0]!.id },
      orderBy: [{ externalTimestamp: "asc" }, { id: "asc" }],
    });
    const latestOutbound = carlosMessages
      .filter((message) => message.direction === "OUTBOUND")
      .at(-1)!;
    const trailingInbound = carlosMessages.filter(
      (message) =>
        message.direction === "INBOUND" &&
        (message.externalTimestamp > latestOutbound.externalTimestamp ||
          (message.externalTimestamp.getTime() ===
            latestOutbound.externalTimestamp.getTime() &&
            message.id > latestOutbound.id)),
    );
    const expectedAwaitingResponseSince = trailingInbound.reduce(
      (earliest, message) =>
        message.externalTimestamp < earliest
          ? message.externalTimestamp
          : earliest,
      trailingInbound[0]!.externalTimestamp,
    );
    const carlosSharedState = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversations[0]!.id },
    });
    expect(carlosSharedState.awaitingResponseSince).toEqual(
      expectedAwaitingResponseSince,
    );

    const reads = await prisma.conversationRead.findMany({
      include: { lastReadMessage: true },
    });
    for (const read of reads) {
      expect(read.lastReadMessage).not.toBeNull();
      expect(read.lastReadAt.getTime()).toBeGreaterThanOrEqual(
        read.lastReadMessage!.externalTimestamp.getTime(),
      );
    }
  });

  it("initializes a retry after a conversation-only interrupted seed", async () => {
    await prisma.user.create({
      data: {
        id: "00000000-0000-4000-8000-000000000001",
        name: "Demo administrator",
        email: "victor@xpatendimento.local",
        passwordHash: "fixture-password-hash",
        role: "ADMIN",
      },
    });
    await prisma.contact.create({
      data: {
        id: "00000000-0000-4000-8000-000000000101",
        whatsappId: "5511987651001",
        phone: "+55 11 98765-1001",
        name: "Demo contact",
      },
    });
    await prisma.conversation.create({
      data: {
        id: "00000000-0000-4000-8000-000000000201",
        contactId: "00000000-0000-4000-8000-000000000101",
        lastMessageAt: new Date("2026-08-18T14:12:00.000Z"),
      },
    });

    await seedDemoData(prisma);
    await seedDemoData(prisma);

    await expect(
      prisma.conversation.findUniqueOrThrow({
        where: { id: "00000000-0000-4000-8000-000000000201" },
      }),
    ).resolves.toMatchObject({
      teamLastReadMessageId: "00000000-0000-4000-8000-000000000303",
      teamLastReadAt: new Date("2026-08-18T14:13:00.000Z"),
      awaitingResponseSince: new Date("2026-08-18T14:12:00.000Z"),
    });
  });

  it("does not overwrite established message or read history", async () => {
    await seedDemoData(prisma);

    const preservedMessageTime = new Date("2026-08-19T14:12:00.000Z");
    const preservedReadTime = new Date("2026-08-19T14:13:00.000Z");
    await prisma.message.update({
      where: { id: "00000000-0000-4000-8000-000000000303" },
      data: { externalTimestamp: preservedMessageTime },
    });
    await prisma.conversationRead.update({
      where: {
        conversationId_userId: {
          conversationId: "00000000-0000-4000-8000-000000000201",
          userId: "00000000-0000-4000-8000-000000000001",
        },
      },
      data: {
        lastReadMessageId: "00000000-0000-4000-8000-000000000303",
        lastReadAt: preservedReadTime,
      },
    });

    await seedDemoData(prisma);

    await expect(
      prisma.message.findUniqueOrThrow({
        where: { id: "00000000-0000-4000-8000-000000000303" },
      }),
    ).resolves.toMatchObject({ externalTimestamp: preservedMessageTime });
    await expect(
      prisma.conversationRead.findUniqueOrThrow({
        where: {
          conversationId_userId: {
            conversationId: "00000000-0000-4000-8000-000000000201",
            userId: "00000000-0000-4000-8000-000000000001",
          },
        },
      }),
    ).resolves.toMatchObject({
      lastReadMessageId: "00000000-0000-4000-8000-000000000303",
      lastReadAt: preservedReadTime,
    });
  });
});
