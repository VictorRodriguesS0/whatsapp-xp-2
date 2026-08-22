// @vitest-environment node

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  MediaStatus,
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

  it("exposes only safe media recovery state in conversation DTOs", async () => {
    const { conversation, user } = await seedEqualTimestampFixture();
    const nextAttemptAt = new Date("2020-01-01T00:00:00.000Z");
    const leaseUntil = new Date("2099-01-01T00:00:00.000Z");
    const media = await prisma.mediaObject.create({
      data: {
        storageProvider: "local-secret-provider",
        storageKey: "secret-storage-key",
        originalFilename: "private-provider-filename.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 4n,
        sha256: "secret-hash",
        metaMediaId: "secret-provider-id",
        status: MediaStatus.PENDING,
        failureReason: "secret-internal-reason",
        downloadLeaseId: "99999999-9999-4999-8999-999999999999",
        downloadLeaseUntil: leaseUntil,
        downloadNextAttemptAt: nextAttemptAt,
        downloadAttempts: 1,
      },
    });
    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: MessageDirection.INBOUND,
        type: MessageType.IMAGE,
        mediaObjectId: media.id,
        status: MessageStatus.RECEIVED,
        externalTimestamp: new Date("2026-08-19T12:01:00.000Z"),
      },
    });

    const detail = await getConversation(user.id, conversation.id);
    const dto = detail.messages.find((candidate) => candidate.id === message.id);

    expect(dto?.mediaState).toEqual({
      status: MediaStatus.PENDING,
      nextAttemptAt: leaseUntil.toISOString(),
      canRetry: false,
    });
    const serialized = JSON.stringify(dto);
    expect(serialized).not.toContain("secret-storage-key");
    expect(serialized).not.toContain("private-provider-filename.jpg");
    expect(serialized).not.toContain("secret-hash");
    expect(serialized).not.toContain("secret-provider-id");
    expect(serialized).not.toContain("secret-internal-reason");
    expect(serialized).not.toContain("99999999-9999-4999-8999-999999999999");
  });
});
