// @vitest-environment node

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  MessageDirection,
  MessageStatus,
  MessageType,
  UserRole,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { resetTestDatabase } from "@/test/database";

import { getConversation, listConversations } from "./service";
import { advanceSharedRead } from "./shared-state";

const lowerId = "20000000-0000-4000-8000-000000000001";
const higherId = "20000000-0000-4000-8000-000000000002";

async function seedEqualTimestampFixture() {
  const timestamp = new Date("2026-08-19T12:00:00.000Z");
  const user = await prisma.user.create({
    data: {
      name: "Victor",
      email: "victor.conversations@example.test",
      passwordHash: "not-used-by-this-fixture",
      role: UserRole.ADMIN,
    },
  });
  const contact = await prisma.contact.create({
    data: {
      whatsappId: "5511999990001",
      phone: "+55 11 99999-0001",
      name: "Carlos",
    },
  });
  const conversation = await prisma.conversation.create({
    data: { contactId: contact.id, lastMessageAt: timestamp },
  });
  await prisma.message.createMany({
    data: [lowerId, higherId].map((id) => ({
      id,
      conversationId: conversation.id,
      direction: MessageDirection.INBOUND,
      type: MessageType.TEXT,
      body: id === lowerId ? "primeira" : "segunda",
      status: MessageStatus.RECEIVED,
      externalTimestamp: timestamp,
    })),
  });

  return { conversation, timestamp, user };
}

describe.skipIf(!process.env.TEST_DATABASE_URL)("conversation Prisma repository", () => {
  beforeEach(resetTestDatabase);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("uses the message id to delimit unread messages at an equal timestamp", async () => {
    const { conversation, user } = await seedEqualTimestampFixture();

    await advanceSharedRead(user.id, conversation.id, lowerId, null);
    await expect(listConversations(user.id, {})).resolves.toMatchObject({
      items: [{ unreadCount: 1, latestMessage: { id: higherId } }],
    });

    const advanced = await advanceSharedRead(
      user.id,
      conversation.id,
      higherId,
      null,
    );
    expect(advanced.unreadCount).toBe(0);
    await expect(listConversations(user.id, {})).resolves.toMatchObject({
      items: [{ unreadCount: 0 }],
    });
  });

  it("keeps the highest equal-timestamp message during concurrent read attempts", async () => {
    const { conversation, user } = await seedEqualTimestampFixture();
    await advanceSharedRead(user.id, conversation.id, lowerId, null);

    await Promise.all([
      advanceSharedRead(user.id, conversation.id, higherId, null),
      advanceSharedRead(user.id, conversation.id, lowerId, null),
    ]);

    await expect(getConversation(user.id, conversation.id)).resolves.toMatchObject({
      lastReadMessageId: higherId,
      unreadCount: 0,
    });
  });
});
