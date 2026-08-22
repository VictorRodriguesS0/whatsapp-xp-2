import { beforeEach, describe, expect, it } from "vitest";

import {
  MessageDirection,
  MessageStatus,
  MessageType,
  UserRole,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { resetTestDatabase } from "@/test/database";

import {
  loadMessageContext,
  searchConversationMessages,
  searchMessages,
} from "./service";

describe.skipIf(!process.env.TEST_DATABASE_URL)("message search PostgreSQL repository", () => {
  beforeEach(resetTestDatabase);

  it("searches indexed content globally and inside one conversation without changing read state", async () => {
    const actor = await prisma.user.create({
      data: {
        name: "Atendente",
        email: "message-search@example.test",
        passwordHash: "not-used",
        role: UserRole.ATTENDANT,
      },
    });
    const [firstContact, secondContact] = await Promise.all([
      prisma.contact.create({ data: { whatsappId: "5561999990001", phone: "+55 61 99999-0001", name: "Ana" } }),
      prisma.contact.create({ data: { whatsappId: "5561999990002", phone: "+55 61 99999-0002", name: "Bia" } }),
    ]);
    const [firstConversation, secondConversation] = await Promise.all([
      prisma.conversation.create({ data: { contactId: firstContact.id, lastMessageAt: new Date("2026-08-22T12:00:00Z") } }),
      prisma.conversation.create({ data: { contactId: secondContact.id, lastMessageAt: new Date("2026-08-22T13:00:00Z") } }),
    ]);
    const firstMessage = await prisma.message.create({
      data: {
        conversationId: firstConversation.id,
        direction: MessageDirection.INBOUND,
        type: MessageType.LOCATION,
        body: "Chego no domingo",
        content: { kind: "location", latitude: -15.7, longitude: -47.8, name: "Loja XP", address: "Asa Norte" },
        status: MessageStatus.DELIVERED,
        externalTimestamp: new Date("2026-08-22T12:00:00Z"),
      },
    });
    await prisma.message.create({
      data: {
        conversationId: secondConversation.id,
        direction: MessageDirection.INBOUND,
        type: MessageType.TEXT,
        body: "Também quero ir domingo",
        status: MessageStatus.DELIVERED,
        externalTimestamp: new Date("2026-08-22T13:00:00Z"),
      },
    });

    const global = await searchMessages(actor.id, { query: "domingo" });
    expect(global.items.map((item) => item.contact.name)).toEqual(["Bia", "Ana"]);

    const scoped = await searchConversationMessages(actor.id, firstConversation.id, { query: "asa norte" });
    expect(scoped.items).toEqual([
      expect.objectContaining({ messageId: firstMessage.id, conversationId: firstConversation.id }),
    ]);

    const context = await loadMessageContext(actor.id, firstConversation.id, firstMessage.id);
    expect(context.messages.map((message) => message.id)).toContain(firstMessage.id);
    await expect(prisma.conversationRead.count()).resolves.toBe(0);
  });
});
