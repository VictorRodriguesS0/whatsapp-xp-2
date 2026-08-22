// @vitest-environment node

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  MessageDirection,
  MessageStatus,
  MessageType,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { resetTestDatabase, seedReadFixture } from "@/test/database";

import {
  reconcileConversationReplyLinks,
  reconcileReplyLinks,
  resolveReplyTarget,
} from "./reply-linking.server";

describe.skipIf(!process.env.TEST_DATABASE_URL)("quoted reply linking primitives", () => {
  beforeEach(resetTestDatabase);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("resolves only a valid official target from the same conversation", async () => {
    const { conversation } = await seedReadFixture();
    const original = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        whatsappMessageId: "wamid.link-target",
        direction: MessageDirection.INBOUND,
        type: MessageType.TEXT,
        status: MessageStatus.RECEIVED,
        externalTimestamp: new Date(),
      },
    });

    await expect(resolveReplyTarget(prisma, conversation.id, original.id))
      .resolves.toEqual({
        id: original.id,
        whatsappMessageId: "wamid.link-target",
      });
    await expect(resolveReplyTarget(
      prisma,
      "10000000-0000-4000-8000-000000000001",
      original.id,
    )).resolves.toBeNull();
  });

  it("links every unresolved reference to a newly available original", async () => {
    const { conversation } = await seedReadFixture();
    const original = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        whatsappMessageId: "wamid.reconcile-target",
        direction: MessageDirection.INBOUND,
        type: MessageType.TEXT,
        status: MessageStatus.RECEIVED,
        externalTimestamp: new Date(),
      },
    });
    await prisma.message.createMany({
      data: [1, 2].map((offset) => ({
        conversationId: conversation.id,
        whatsappMessageId: `wamid.reconcile-reply-${offset}`,
        replyToWhatsappMessageId: original.whatsappMessageId,
        direction: MessageDirection.INBOUND,
        type: MessageType.TEXT,
        status: MessageStatus.RECEIVED,
        externalTimestamp: new Date(Date.now() + offset),
      })),
    });

    await expect(reconcileReplyLinks(prisma, {
      conversationId: conversation.id,
      messageId: original.id,
      whatsappMessageId: original.whatsappMessageId!,
    })).resolves.toBe(2);
    await expect(prisma.message.count({
      where: { conversationId: conversation.id, replyToMessageId: original.id },
    })).resolves.toBe(2);
  });

  it("repairs a conversation in bulk without crossing its boundary", async () => {
    const { conversation } = await seedReadFixture();
    const original = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        whatsappMessageId: "wamid.bulk-target",
        direction: MessageDirection.INBOUND,
        type: MessageType.TEXT,
        status: MessageStatus.RECEIVED,
        externalTimestamp: new Date(),
      },
    });
    const reply = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        whatsappMessageId: "wamid.bulk-reply",
        replyToWhatsappMessageId: original.whatsappMessageId,
        direction: MessageDirection.INBOUND,
        type: MessageType.TEXT,
        status: MessageStatus.RECEIVED,
        externalTimestamp: new Date(),
      },
    });

    await expect(reconcileConversationReplyLinks(prisma, conversation.id))
      .resolves.toBe(1);
    await expect(prisma.message.findUniqueOrThrow({
      where: { id: reply.id },
      select: { replyToMessageId: true },
    })).resolves.toEqual({ replyToMessageId: original.id });
  });
});
