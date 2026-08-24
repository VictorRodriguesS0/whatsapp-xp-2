// @vitest-environment node

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { Prisma } from "@/generated/prisma/client";
import {
  MediaStatus,
  MessageDirection,
  MessageStatus,
  MessageType,
  UserRole,
  WebhookStatus,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { refreshResponseState } from "@/modules/conversations/shared-state";
import type { RealtimeEvent } from "@/modules/realtime/events";
import { subscribeRealtime } from "@/modules/realtime/hub";
import { resetTestDatabase } from "@/test/database";

import {
  createPrismaWebhookRepository,
  processWebhookEvents,
  type WebhookProcessDependencies,
} from "./process";
import type {
  NormalizedContactSyncBatchEvent,
  NormalizedMessageEchoControlEvent,
  NormalizedMessageEchoEvent,
  NormalizedMessageEvent,
  NormalizedReactionEchoEvent,
  NormalizedReactionEvent,
} from "./types";

function echoEvent(
  whatsappMessageId: string,
  options: {
    to?: string | null;
    toUserId?: string | null;
    timestamp?: Date;
    body?: string | null;
    content?: NormalizedMessageEchoEvent["content"];
    media?: NormalizedMessageEchoEvent["media"];
    type?: NormalizedMessageEchoEvent["type"];
    replyToWhatsappMessageId?: string | null;
  } = {},
): NormalizedMessageEchoEvent {
  const timestamp = options.timestamp ?? new Date("2026-08-21T12:00:00.000Z");

  return {
    kind: "messageEcho",
    whatsappMessageId,
    to: options.to === undefined ? "551100000001" : options.to,
    toUserId: options.toUserId ?? null,
    toParentUserId: null,
    timestamp,
    timestampRaw: String(timestamp.getTime() / 1000),
    type: options.type ?? (options.media ? MessageType.IMAGE : MessageType.TEXT),
    body: options.body === undefined ? "echo body" : options.body,
    content: options.content ?? null,
    media: options.media ?? null,
    replyToWhatsappMessageId: options.replyToWhatsappMessageId ?? null,
    origin: "WHATSAPP_BUSINESS_APP",
  };
}

function inboundEvent(
  whatsappMessageId: string,
  from: string,
  timestamp: Date,
  replyToWhatsappMessageId: string | null = null,
): NormalizedMessageEvent {
  return {
    kind: "message",
    whatsappMessageId,
    from,
    contactName: "Existing contact",
    timestamp,
    timestampRaw: String(timestamp.getTime() / 1000),
    type: MessageType.TEXT,
    body: "inbound body",
    content: null,
    media: null,
    replyToWhatsappMessageId,
  };
}

function controlEvent(
  action: "EDIT" | "REVOKE",
  whatsappMessageId: string,
): NormalizedMessageEchoControlEvent {
  return {
    kind: "messageEchoControl",
    action,
    whatsappMessageId,
    originalWhatsappMessageId: "wamid.control-original",
    to: null,
    toUserId: "BR.ControlCustomer",
    toParentUserId: null,
    timestamp: new Date("2026-08-21T12:00:00.000Z"),
    timestampRaw: "1787313600",
    origin: "WHATSAPP_BUSINESS_APP",
  };
}

function reactionEvent(
  whatsappMessageId: string,
  targetWhatsappMessageId: string,
  emoji: string,
  options: { from?: string; timestamp?: Date } = {},
): NormalizedReactionEvent {
  const timestamp = options.timestamp ?? new Date("2026-08-21T12:01:00.000Z");
  return {
    kind: "reaction",
    whatsappMessageId,
    targetWhatsappMessageId,
    from: options.from ?? "551100000031",
    contactName: "Reaction contact",
    emoji,
    timestamp,
    timestampRaw: String(timestamp.getTime() / 1_000),
  };
}

function reactionEchoEvent(
  whatsappMessageId: string,
  targetWhatsappMessageId: string,
  emoji: string,
  options: { to?: string | null; toUserId?: string | null; timestamp?: Date } = {},
): NormalizedReactionEchoEvent {
  const timestamp = options.timestamp ?? new Date("2026-08-21T12:01:00.000Z");
  return {
    kind: "reactionEcho",
    whatsappMessageId,
    targetWhatsappMessageId,
    to: options.to === undefined ? "551100000031" : options.to,
    toUserId: options.toUserId ?? null,
    toParentUserId: null,
    emoji,
    timestamp,
    timestampRaw: String(timestamp.getTime() / 1_000),
    origin: "WHATSAPP_BUSINESS_APP",
  };
}

async function seedReactionTarget() {
  const contact = await prisma.contact.create({
    data: {
      whatsappId: "551100000031",
      whatsappUserId: "BR.ReactionCustomer",
      phone: "551100000031",
      name: "Reaction contact",
    },
  });
  const conversation = await prisma.conversation.create({
    data: {
      contactId: contact.id,
      lastMessageAt: new Date("2026-08-21T12:00:00.000Z"),
      awaitingResponseSince: new Date("2026-08-21T11:59:00.000Z"),
    },
  });
  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      whatsappMessageId: "wamid.reaction-target",
      direction: MessageDirection.OUTBOUND,
      type: MessageType.TEXT,
      body: "Target",
      status: MessageStatus.SENT,
      externalTimestamp: new Date("2026-08-21T12:00:00.000Z"),
    },
  });
  return { contact, conversation, message };
}

function transactionDependencies(
  realtime: RealtimeEvent[],
): WebhookProcessDependencies {
  return {
    transaction: (operation) =>
      prisma.$transaction(
        (transaction) => operation(createPrismaWebhookRepository(transaction)),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    recordFailure: async () => {
      throw new Error("unexpected recordFailure");
    },
    quarantineEvent: async () => {
      throw new Error("unexpected quarantineEvent");
    },
    publishRealtime: (event) => realtime.push(event),
  };
}

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "WhatsApp message echo PostgreSQL persistence",
  () => {
    beforeEach(resetTestDatabase);

    afterAll(async () => {
      await prisma.$disconnect();
    });

    it("persists a legacy phone-only echo as actorless outbound SENT", async () => {
      await expect(
        processWebhookEvents([
          echoEvent("wamid.echo-phone-only", { toUserId: null }),
        ]),
      ).resolves.toEqual({ processed: 1, duplicates: 0 });

      await expect(prisma.contact.findFirst()).resolves.toMatchObject({
        whatsappId: "551100000001",
        phone: "551100000001",
        whatsappUserId: null,
      });
      await expect(prisma.conversation.count()).resolves.toBe(1);
      await expect(prisma.message.findFirst()).resolves.toMatchObject({
        whatsappMessageId: "wamid.echo-phone-only",
        direction: MessageDirection.OUTBOUND,
        status: MessageStatus.SENT,
        sentByUserId: null,
        body: "echo body",
      });
    });

    it("links a reply to an original already stored in the same conversation", async () => {
      const original = inboundEvent(
        "wamid.reply-original-first",
        "551100000031",
        new Date("2026-08-21T12:00:00.000Z"),
      );
      const reply = inboundEvent(
        "wamid.reply-child-second",
        original.from,
        new Date("2026-08-21T12:01:00.000Z"),
        original.whatsappMessageId,
      );

      await processWebhookEvents([original, reply]);

      const storedOriginal = await prisma.message.findUniqueOrThrow({
        where: { whatsappMessageId: original.whatsappMessageId },
      });
      await expect(prisma.message.findUniqueOrThrow({
        where: { whatsappMessageId: reply.whatsappMessageId },
        select: { replyToMessageId: true, replyToWhatsappMessageId: true },
      })).resolves.toEqual({
        replyToMessageId: storedOriginal.id,
        replyToWhatsappMessageId: original.whatsappMessageId,
      });
    });

    it("backfills the local reply link when the original arrives after its reply", async () => {
      const original = inboundEvent(
        "wamid.reply-original-late",
        "551100000032",
        new Date("2026-08-21T12:00:00.000Z"),
      );
      const reply = inboundEvent(
        "wamid.reply-child-first",
        original.from,
        new Date("2026-08-21T12:01:00.000Z"),
        original.whatsappMessageId,
      );

      await processWebhookEvents([reply]);
      await expect(prisma.message.findUniqueOrThrow({
        where: { whatsappMessageId: reply.whatsappMessageId },
        select: { replyToMessageId: true, replyToWhatsappMessageId: true },
      })).resolves.toEqual({
        replyToMessageId: null,
        replyToWhatsappMessageId: original.whatsappMessageId,
      });

      await processWebhookEvents([original]);

      const storedOriginal = await prisma.message.findUniqueOrThrow({
        where: { whatsappMessageId: original.whatsappMessageId },
      });
      await expect(prisma.message.findUniqueOrThrow({
        where: { whatsappMessageId: reply.whatsappMessageId },
        select: { replyToMessageId: true, replyToWhatsappMessageId: true },
      })).resolves.toEqual({
        replyToMessageId: storedOriginal.id,
        replyToWhatsappMessageId: original.whatsappMessageId,
      });
    });

    it("keeps unknown and cross-conversation reply references unresolved", async () => {
      const original = inboundEvent(
        "wamid.reply-cross-original",
        "551100000033",
        new Date("2026-08-21T12:00:00.000Z"),
      );
      const crossConversationReply = inboundEvent(
        "wamid.reply-cross-child",
        "551100000034",
        new Date("2026-08-21T12:01:00.000Z"),
        original.whatsappMessageId,
      );
      const unknownReply = inboundEvent(
        "wamid.reply-unknown-child",
        original.from,
        new Date("2026-08-21T12:02:00.000Z"),
        "wamid.reply-unknown-original",
      );

      await processWebhookEvents([original, crossConversationReply, unknownReply]);

      await expect(prisma.message.findMany({
        where: {
          whatsappMessageId: {
            in: [
              crossConversationReply.whatsappMessageId,
              unknownReply.whatsappMessageId,
            ],
          },
        },
        orderBy: { whatsappMessageId: "asc" },
        select: { replyToMessageId: true, replyToWhatsappMessageId: true },
      })).resolves.toEqual([
        {
          replyToMessageId: null,
          replyToWhatsappMessageId: original.whatsappMessageId,
        },
        {
          replyToMessageId: null,
          replyToWhatsappMessageId: "wamid.reply-unknown-original",
        },
      ]);
    });

    it("creates a BSUID-only contact and later attaches the overlapping phone", async () => {
      await processWebhookEvents([
        echoEvent("wamid.echo-bsuid-only", {
          to: null,
          toUserId: "BR.BsuidCustomer",
        }),
      ]);
      const initial = await prisma.contact.findFirstOrThrow();

      expect(initial).toMatchObject({
        whatsappId: null,
        phone: null,
        whatsappUserId: "BR.BsuidCustomer",
      });

      await processWebhookEvents([
        echoEvent("wamid.echo-bsuid-overlap", {
          to: "551100000002",
          toUserId: "BR.BsuidCustomer",
        }),
      ]);

      await expect(prisma.contact.findMany()).resolves.toEqual([
        expect.objectContaining({
          id: initial.id,
          whatsappId: "551100000002",
          phone: "551100000002",
          whatsappUserId: "BR.BsuidCustomer",
        }),
      ]);
      await expect(prisma.conversation.count()).resolves.toBe(1);
      await expect(prisma.message.count()).resolves.toBe(2);
    });

    it("attaches a BSUID to a legacy phone contact on overlap", async () => {
      await processWebhookEvents([
        echoEvent("wamid.echo-legacy-first", {
          to: "551100000003",
          toUserId: null,
        }),
      ]);
      const initial = await prisma.contact.findFirstOrThrow();

      await processWebhookEvents([
        echoEvent("wamid.echo-legacy-overlap", {
          to: "551100000003",
          toUserId: "BR.LegacyCustomer",
        }),
      ]);

      await expect(prisma.contact.findMany()).resolves.toEqual([
        expect.objectContaining({
          id: initial.id,
          phone: "551100000003",
          whatsappUserId: "BR.LegacyCustomer",
        }),
      ]);
      await expect(prisma.conversation.count()).resolves.toBe(1);
    });

    it("atomically converges separate phone-only and BSUID-only histories on overlap", async () => {
      await processWebhookEvents([
        echoEvent("wamid.echo-separated-phone", {
          to: "551100000004",
          toUserId: null,
        }),
      ]);
      await processWebhookEvents([
        echoEvent("wamid.echo-separated-bsuid", {
          to: null,
          toUserId: "BR.SeparateCustomer",
          replyToWhatsappMessageId: "wamid.echo-separated-phone",
        }),
      ]);

      expect(await prisma.contact.count()).toBe(2);
      expect(await prisma.conversation.count()).toBe(2);

      await processWebhookEvents([
        echoEvent("wamid.echo-separated-overlap", {
          to: "551100000004",
          toUserId: "BR.SeparateCustomer",
        }),
      ]);

      await expect(prisma.contact.findMany()).resolves.toEqual([
        expect.objectContaining({
          phone: "551100000004",
          whatsappUserId: "BR.SeparateCustomer",
        }),
      ]);
      await expect(prisma.conversation.count()).resolves.toBe(1);
      const messages = await prisma.message.findMany({
        select: { conversationId: true },
      });
      expect(messages).toHaveLength(3);
      expect(new Set(messages.map(({ conversationId }) => conversationId))).toHaveLength(
        1,
      );
      const original = await prisma.message.findUniqueOrThrow({
        where: { whatsappMessageId: "wamid.echo-separated-phone" },
      });
      await expect(prisma.message.findUniqueOrThrow({
        where: { whatsappMessageId: "wamid.echo-separated-bsuid" },
        select: { replyToMessageId: true, replyToWhatsappMessageId: true },
      })).resolves.toEqual({
        replyToMessageId: original.id,
        replyToWhatsappMessageId: original.whatsappMessageId,
      });
    });

    it("refreshes an answered target from a merged newer inbound on a duplicate API echo", async () => {
      const outboundTimestamp = new Date("2026-08-21T10:00:00.000Z");
      const inboundTimestamp = new Date("2026-08-21T12:00:00.000Z");
      const clientRequestId = "30000000-0000-4000-8000-000000000001";
      const actor = await prisma.user.create({
        data: {
          name: "Merge actor",
          email: "merge-inbound-actor@example.test",
          passwordHash: "not-used",
          role: UserRole.ADMIN,
        },
      });
      const targetContact = await prisma.contact.create({
        data: {
          whatsappId: "551100000026",
          phone: "551100000026",
          name: "Phone target",
        },
      });
      const sourceContact = await prisma.contact.create({
        data: {
          whatsappId: null,
          whatsappUserId: "BR.MergeInbound",
          phone: null,
          name: "BSUID source",
        },
      });
      const targetConversation = await prisma.conversation.create({
        data: { contactId: targetContact.id, lastMessageAt: outboundTimestamp },
      });
      const sourceConversation = await prisma.conversation.create({
        data: { contactId: sourceContact.id, lastMessageAt: inboundTimestamp },
      });
      const media = await prisma.mediaObject.create({
        data: {
          storageProvider: "local",
          storageKey: "merge/original",
          originalFilename: "original.jpg",
          mimeType: "image/jpeg",
          sizeBytes: 8n,
          sha256: "b".repeat(64),
          metaMediaId: "meta-merge-original",
          status: MediaStatus.AVAILABLE,
        },
      });
      const apiMessage = await prisma.message.create({
        data: {
          conversationId: targetConversation.id,
          whatsappMessageId: "wamid.echo-merge-inbound-duplicate",
          clientRequestId,
          direction: MessageDirection.OUTBOUND,
          type: MessageType.IMAGE,
          body: "authoritative API body",
          mediaObjectId: media.id,
          sentByUserId: actor.id,
          status: MessageStatus.DELIVERED,
          externalTimestamp: outboundTimestamp,
        },
      });
      await prisma.message.create({
        data: {
          conversationId: sourceConversation.id,
          whatsappMessageId: "wamid.echo-merge-inbound-source",
          direction: MessageDirection.INBOUND,
          type: MessageType.TEXT,
          body: "newer source inbound",
          status: MessageStatus.RECEIVED,
          externalTimestamp: inboundTimestamp,
        },
      });
      const realtime: RealtimeEvent[] = [];

      await expect(
        processWebhookEvents(
          [
            echoEvent("wamid.echo-merge-inbound-duplicate", {
              to: "551100000026",
              toUserId: "BR.MergeInbound",
              body: "must not replace API body",
            }),
          ],
          transactionDependencies(realtime),
        ),
      ).resolves.toEqual({ processed: 0, duplicates: 1 });

      await expect(
        prisma.message.findUniqueOrThrow({ where: { id: apiMessage.id } }),
      ).resolves.toMatchObject({
        conversationId: targetConversation.id,
        whatsappMessageId: "wamid.echo-merge-inbound-duplicate",
        clientRequestId,
        direction: MessageDirection.OUTBOUND,
        type: MessageType.IMAGE,
        body: "authoritative API body",
        mediaObjectId: media.id,
        sentByUserId: actor.id,
        status: MessageStatus.DELIVERED,
      });
      await expect(
        prisma.conversation.findUniqueOrThrow({
          where: { id: targetConversation.id },
          select: { awaitingResponseSince: true },
        }),
      ).resolves.toEqual({ awaitingResponseSince: inboundTimestamp });
      await expect(
        prisma.conversation.findUnique({ where: { id: sourceConversation.id } }),
      ).resolves.toBeNull();
      await expect(prisma.message.count()).resolves.toBe(2);
      expect(realtime).toEqual([
        {
          type: "conversation.merged",
          sourceConversationId: sourceConversation.id,
          targetConversationId: targetConversation.id,
        },
      ]);
    });

    it("refreshes an awaiting target to answered when a merged source has a newer outbound", async () => {
      const duplicateOutboundTimestamp = new Date("2026-08-21T09:00:00.000Z");
      const targetInboundTimestamp = new Date("2026-08-21T10:00:00.000Z");
      const sourceOutboundTimestamp = new Date("2026-08-21T12:00:00.000Z");
      const targetContact = await prisma.contact.create({
        data: {
          whatsappId: "551100000027",
          phone: "551100000027",
          name: "Awaiting target",
        },
      });
      const sourceContact = await prisma.contact.create({
        data: {
          whatsappId: null,
          whatsappUserId: "BR.MergeOutbound",
          phone: null,
          name: "Answered source",
        },
      });
      const targetConversation = await prisma.conversation.create({
        data: { contactId: targetContact.id, lastMessageAt: targetInboundTimestamp },
      });
      const sourceConversation = await prisma.conversation.create({
        data: { contactId: sourceContact.id, lastMessageAt: sourceOutboundTimestamp },
      });
      await prisma.message.createMany({
        data: [
          {
            conversationId: targetConversation.id,
            whatsappMessageId: "wamid.echo-merge-outbound-duplicate",
            direction: MessageDirection.OUTBOUND,
            type: MessageType.TEXT,
            body: "older API outbound",
            status: MessageStatus.SENT,
            externalTimestamp: duplicateOutboundTimestamp,
          },
          {
            conversationId: targetConversation.id,
            whatsappMessageId: "wamid.echo-merge-outbound-target-inbound",
            direction: MessageDirection.INBOUND,
            type: MessageType.TEXT,
            body: "target inbound",
            status: MessageStatus.RECEIVED,
            externalTimestamp: targetInboundTimestamp,
          },
          {
            conversationId: sourceConversation.id,
            whatsappMessageId: "wamid.echo-merge-outbound-source",
            direction: MessageDirection.OUTBOUND,
            type: MessageType.TEXT,
            body: "newer source outbound",
            status: MessageStatus.SENT,
            externalTimestamp: sourceOutboundTimestamp,
          },
        ],
      });
      await refreshResponseState(prisma, targetConversation.id);
      await expect(
        prisma.conversation.findUniqueOrThrow({
          where: { id: targetConversation.id },
          select: { awaitingResponseSince: true },
        }),
      ).resolves.toEqual({ awaitingResponseSince: targetInboundTimestamp });

      await processWebhookEvents(
        [
          echoEvent("wamid.echo-merge-outbound-duplicate", {
            to: "551100000027",
            toUserId: "BR.MergeOutbound",
          }),
        ],
        transactionDependencies([]),
      );

      await expect(
        prisma.conversation.findUniqueOrThrow({
          where: { id: targetConversation.id },
          select: { awaitingResponseSince: true },
        }),
      ).resolves.toEqual({ awaitingResponseSince: null });
    });

    it("publishes an ID-only conversation.merged event before message.created after commit", async () => {
      const phoneContact = await prisma.contact.create({
        data: {
          whatsappId: "551100000025",
          phone: "551100000025",
          name: "Phone contact",
        },
      });
      const bsuidContact = await prisma.contact.create({
        data: {
          whatsappId: null,
          whatsappUserId: "BR.MergeRealtime",
          phone: null,
          name: "BSUID contact",
        },
      });
      const targetConversation = await prisma.conversation.create({
        data: {
          contactId: phoneContact.id,
          lastMessageAt: new Date("2026-08-21T12:00:00.000Z"),
        },
      });
      const sourceConversation = await prisma.conversation.create({
        data: {
          contactId: bsuidContact.id,
          lastMessageAt: new Date("2026-08-21T12:00:00.000Z"),
        },
      });
      const abortController = new AbortController();
      const reader = subscribeRealtime(abortController.signal).getReader();
      await reader.read();

      try {
        await processWebhookEvents([
          echoEvent("wamid.echo-merge-realtime", {
            to: "551100000025",
            toUserId: "BR.MergeRealtime",
          }),
        ]);

        const decodeEvent = async () => {
          const chunk = new TextDecoder().decode((await reader.read()).value);
          return JSON.parse(chunk.split("data: ")[1]!.trim()) as unknown;
        };
        await expect(decodeEvent()).resolves.toEqual({
          type: "conversation.merged",
          sourceConversationId: sourceConversation.id,
          targetConversationId: targetConversation.id,
        });
        await expect(decodeEvent()).resolves.toEqual({
          type: "message.created",
          conversationId: targetConversation.id,
          messageId: expect.any(String),
        });
        await expect(
          prisma.conversation.findUnique({
            where: { id: sourceConversation.id },
          }),
        ).resolves.toBeNull();
      } finally {
        abortController.abort();
      }
    });

    it("preserves timestamp-only shared and per-user boundaries over equal-time pointers during convergence", async () => {
      const boundaryTimestamp = new Date("2026-08-21T12:00:00.000Z");
      await processWebhookEvents([
        echoEvent("wamid.echo-boundary-phone", {
          to: "551100000014",
          toUserId: null,
          timestamp: boundaryTimestamp,
        }),
      ]);
      await processWebhookEvents([
        echoEvent("wamid.echo-boundary-bsuid", {
          to: null,
          toUserId: "BR.BoundaryCustomer",
          timestamp: boundaryTimestamp,
        }),
      ]);
      const phoneContact = await prisma.contact.findUniqueOrThrow({
        where: { phone: "551100000014" },
        include: { conversation: true },
      });
      const bsuidContact = await prisma.contact.findUniqueOrThrow({
        where: { whatsappUserId: "BR.BoundaryCustomer" },
        include: { conversation: true },
      });
      const phoneMessage = await prisma.message.findUniqueOrThrow({
        where: { whatsappMessageId: "wamid.echo-boundary-phone" },
      });
      const user = await prisma.user.create({
        data: {
          name: "Boundary reader",
          email: "boundary-reader@example.test",
          passwordHash: "not-used",
          role: UserRole.ATTENDANT,
        },
      });

      await prisma.conversation.update({
        where: { id: phoneContact.conversation!.id },
        data: {
          teamLastReadMessageId: phoneMessage.id,
          teamLastReadAt: boundaryTimestamp,
        },
      });
      await prisma.conversation.update({
        where: { id: bsuidContact.conversation!.id },
        data: {
          teamLastReadMessageId: null,
          teamLastReadAt: boundaryTimestamp,
        },
      });
      await prisma.conversationRead.createMany({
        data: [
          {
            conversationId: phoneContact.conversation!.id,
            userId: user.id,
            lastReadMessageId: phoneMessage.id,
            lastReadAt: boundaryTimestamp,
          },
          {
            conversationId: bsuidContact.conversation!.id,
            userId: user.id,
            lastReadMessageId: null,
            lastReadAt: boundaryTimestamp,
          },
        ],
      });

      await processWebhookEvents([
        echoEvent("wamid.echo-boundary-overlap", {
          to: "551100000014",
          toUserId: "BR.BoundaryCustomer",
          timestamp: new Date("2026-08-21T12:01:00.000Z"),
        }),
      ]);

      await expect(prisma.conversation.findFirstOrThrow()).resolves.toMatchObject({
        teamLastReadMessageId: null,
        teamLastReadAt: boundaryTimestamp,
      });
      await expect(prisma.conversationRead.findFirstOrThrow()).resolves.toMatchObject({
        lastReadMessageId: null,
        lastReadAt: boundaryTimestamp,
      });
    });

    it("rejects conflicting source identities atomically instead of merging histories", async () => {
      await processWebhookEvents([
        echoEvent("wamid.echo-conflict-target", {
          to: "551100000015",
          toUserId: null,
        }),
      ]);
      await processWebhookEvents([
        echoEvent("wamid.echo-conflict-source", {
          to: null,
          toUserId: "BR.ConflictCustomer",
        }),
      ]);
      await processWebhookEvents([
        echoEvent("wamid.echo-conflict-source-phone", {
          to: "551100000016",
          toUserId: "BR.ConflictCustomer",
          timestamp: new Date("2026-08-21T12:01:00.000Z"),
        }),
      ]);
      const snapshot = {
        contacts: await prisma.contact.findMany({
          orderBy: { id: "asc" },
          select: {
            id: true,
            whatsappId: true,
            whatsappUserId: true,
            phone: true,
          },
        }),
        conversations: await prisma.conversation.findMany({
          orderBy: { id: "asc" },
          select: { id: true, contactId: true, lastMessageAt: true },
        }),
        messages: await prisma.message.findMany({
          orderBy: { id: "asc" },
          select: { id: true, conversationId: true, whatsappMessageId: true },
        }),
        mediaCount: await prisma.mediaObject.count(),
      };

      await expect(
        processWebhookEvents([
          echoEvent("wamid.echo-conflict-overlap", {
            to: "551100000015",
            toUserId: "BR.ConflictCustomer",
            timestamp: new Date("2026-08-21T12:02:00.000Z"),
          }),
        ]),
      ).resolves.toEqual({ processed: 0, duplicates: 0, quarantined: 1 });

      await expect(
        prisma.contact.findMany({
          orderBy: { id: "asc" },
          select: {
            id: true,
            whatsappId: true,
            whatsappUserId: true,
            phone: true,
          },
        }),
      ).resolves.toEqual(snapshot.contacts);
      await expect(
        prisma.conversation.findMany({
          orderBy: { id: "asc" },
          select: { id: true, contactId: true, lastMessageAt: true },
        }),
      ).resolves.toEqual(snapshot.conversations);
      await expect(
        prisma.message.findMany({
          orderBy: { id: "asc" },
          select: { id: true, conversationId: true, whatsappMessageId: true },
        }),
      ).resolves.toEqual(snapshot.messages);
      await expect(prisma.mediaObject.count()).resolves.toBe(snapshot.mediaCount);
      await expect(
        prisma.webhookEvent.findUniqueOrThrow({
          where: {
            deduplicationKey: "message-echo:wamid.echo-conflict-overlap",
          },
        }),
      ).resolves.toMatchObject({
        status: WebhookStatus.PROCESSED,
        errorSummary: "quarantined:identity_conflict",
        processedAt: expect.any(Date),
      });
    });

    it("rejects a phone-less BSUID source with a conflicting legacy phone identity atomically", async () => {
      await prisma.contact.createMany({
        data: [
          {
            whatsappId: "551100000017",
            whatsappUserId: null,
            phone: "551100000017",
            name: "Phone target",
          },
          {
            whatsappId: "551100000018",
            whatsappUserId: "BR.LegacyPhoneConflict",
            phone: null,
            name: "BSUID source",
          },
        ],
      });
      const contactsBefore = await prisma.contact.findMany({
        orderBy: { whatsappId: "asc" },
        select: {
          id: true,
          whatsappId: true,
          whatsappUserId: true,
          phone: true,
          name: true,
        },
      });

      await expect(
        processWebhookEvents([
          echoEvent("wamid.echo-legacy-phone-conflict", {
            to: "551100000017",
            toUserId: "BR.LegacyPhoneConflict",
          }),
        ]),
      ).resolves.toEqual({ processed: 0, duplicates: 0, quarantined: 1 });

      await expect(
        prisma.contact.findMany({
          orderBy: { whatsappId: "asc" },
          select: {
            id: true,
            whatsappId: true,
            whatsappUserId: true,
            phone: true,
            name: true,
          },
        }),
      ).resolves.toEqual(contactsBefore);
      await expect(prisma.conversation.count()).resolves.toBe(0);
      await expect(prisma.message.count()).resolves.toBe(0);
      await expect(
        prisma.webhookEvent.findUniqueOrThrow({
          where: {
            deduplicationKey:
              "message-echo:wamid.echo-legacy-phone-conflict",
          },
        }),
      ).resolves.toMatchObject({
        status: WebhookStatus.PROCESSED,
        errorSummary: "quarantined:identity_conflict",
        processedAt: expect.any(Date),
      });
    });

    it("quarantines conflicting cross-column candidates, continues the batch and deduplicates redelivery", async () => {
      const firstCandidate = await prisma.contact.create({
        data: {
          whatsappId: null,
          whatsappUserId: "BR.CrossColumnOne",
          phone: "551100000021",
          name: "First candidate",
        },
      });
      const secondCandidate = await prisma.contact.create({
        data: {
          whatsappId: "551100000021",
          whatsappUserId: "BR.CrossColumnTwo",
          phone: null,
          name: "Second candidate",
        },
      });
      const originalCandidates = await prisma.contact.findMany({
        where: { id: { in: [firstCandidate.id, secondCandidate.id] } },
        orderBy: { id: "asc" },
      });
      const conflict = echoEvent("wamid.echo-cross-column-conflict", {
        to: "551100000021",
        toUserId: null,
      });

      await expect(
        processWebhookEvents([
          conflict,
          echoEvent("wamid.echo-after-quarantine", {
            to: "551100000022",
            toUserId: null,
          }),
        ]),
      ).resolves.toEqual({ processed: 1, duplicates: 0, quarantined: 1 });

      await expect(
        prisma.contact.findMany({
          where: { id: { in: [firstCandidate.id, secondCandidate.id] } },
          orderBy: { id: "asc" },
        }),
      ).resolves.toEqual(originalCandidates);
      await expect(
        prisma.message.findMany({ select: { whatsappMessageId: true } }),
      ).resolves.toEqual([
        { whatsappMessageId: "wamid.echo-after-quarantine" },
      ]);
      await expect(
        prisma.webhookEvent.findUniqueOrThrow({
          where: {
            deduplicationKey:
              "message-echo:wamid.echo-cross-column-conflict",
          },
        }),
      ).resolves.toMatchObject({
        status: WebhookStatus.PROCESSED,
        errorSummary: "quarantined:identity_conflict",
        processedAt: expect.any(Date),
      });

      await expect(processWebhookEvents([conflict])).resolves.toEqual({
        processed: 0,
        duplicates: 1,
      });
      await expect(prisma.message.count()).resolves.toBe(1);
    });

    it("allows a phone-less BSUID source whose legacy whatsappId is its own BSUID", async () => {
      const phoneContact = await prisma.contact.create({
        data: {
          whatsappId: "551100000019",
          whatsappUserId: null,
          phone: "551100000019",
          name: "Phone target",
        },
      });
      await prisma.contact.create({
        data: {
          whatsappId: "BR.LegacyCanonicalUser",
          whatsappUserId: "BR.LegacyCanonicalUser",
          phone: null,
          name: "BSUID source",
        },
      });

      await expect(
        processWebhookEvents([
          echoEvent("wamid.echo-legacy-canonical-bsuid", {
            to: "551100000019",
            toUserId: "BR.LegacyCanonicalUser",
          }),
        ]),
      ).resolves.toEqual({ processed: 1, duplicates: 0 });

      await expect(prisma.contact.findMany()).resolves.toEqual([
        expect.objectContaining({
          id: phoneContact.id,
          whatsappId: "551100000019",
          whatsappUserId: "BR.LegacyCanonicalUser",
          phone: "551100000019",
        }),
      ]);
      await expect(prisma.message.count()).resolves.toBe(1);
    });

    it("deterministically converges compatible cross-column phone candidates", async () => {
      const canonical = await prisma.contact.create({
        data: {
          whatsappId: null,
          whatsappUserId: null,
          phone: "551100000020",
          name: "Canonical phone",
        },
      });
      await prisma.contact.create({
        data: {
          whatsappId: "551100000020",
          whatsappUserId: null,
          phone: null,
          name: "Legacy phone",
        },
      });

      await expect(
        processWebhookEvents([
          echoEvent("wamid.echo-cross-column-compatible", {
            to: "551100000020",
            toUserId: null,
          }),
        ]),
      ).resolves.toEqual({ processed: 1, duplicates: 0 });

      await expect(prisma.contact.findMany()).resolves.toEqual([
        expect.objectContaining({
          id: canonical.id,
          whatsappId: "551100000020",
          phone: "551100000020",
        }),
      ]);
      await expect(prisma.conversation.count()).resolves.toBe(1);
      await expect(prisma.message.count()).resolves.toBe(1);
    });

    it("persists and schedules media only once across duplicate delivery", async () => {
      const event = echoEvent("wamid.echo-media", {
        to: null,
        toUserId: "BR.MediaCustomer",
        body: "caption",
        media: {
          metaMediaId: "meta-echo-media",
          mimeType: "image/jpeg",
          sha256: null,
          filename: null,
        },
      });
      const scheduled: string[] = [];

      await processWebhookEvents([event], undefined, (id) => scheduled.push(id));
      await processWebhookEvents([event], undefined, (id) => scheduled.push(id));

      expect(scheduled).toHaveLength(1);
      await expect(prisma.mediaObject.findMany()).resolves.toEqual([
        expect.objectContaining({
          metaMediaId: "meta-echo-media",
          status: MediaStatus.PENDING,
        }),
      ]);
      await expect(prisma.message.count()).resolves.toBe(1);
    });

    it("serializes concurrent duplicate echoes into one message", async () => {
      const event = echoEvent("wamid.echo-concurrent", {
        to: null,
        toUserId: "BR.ConcurrentCustomer",
      });

      const summaries = await Promise.all([
        processWebhookEvents([event]),
        processWebhookEvents([event]),
      ]);

      expect(summaries.map(({ processed }) => processed).sort()).toEqual([0, 1]);
      expect(summaries.map(({ duplicates }) => duplicates).sort()).toEqual([0, 1]);
      await expect(prisma.message.count()).resolves.toBe(1);
      await expect(prisma.webhookEvent.count()).resolves.toBe(1);
    });

    it("persists WhatsApp Business App location content exactly once", async () => {
      const content = {
        kind: "location",
        latitude: -15.793889,
        longitude: -47.882778,
        name: "XP Eletrônicos",
        address: "Brasília - DF",
      } as const;
      const event = echoEvent("wamid.echo-location", {
        type: MessageType.LOCATION,
        body: null,
        content,
      });

      await processWebhookEvents([event, event]);

      await expect(
        prisma.message.findMany({
          select: { direction: true, type: true, content: true },
        }),
      ).resolves.toEqual([
        {
          direction: MessageDirection.OUTBOUND,
          type: MessageType.LOCATION,
          content,
        },
      ]);
    });

    it("does not clobber an API-created message when its echo overlaps", async () => {
      const user = await prisma.user.create({
        data: {
          name: "Internal actor",
          email: "echo-actor@example.test",
          passwordHash: "not-used",
          role: UserRole.ADMIN,
        },
      });
      const contact = await prisma.contact.create({
        data: {
          whatsappId: "551100000005",
          phone: "551100000005",
          name: "Existing contact",
        },
      });
      const conversation = await prisma.conversation.create({
        data: {
          contactId: contact.id,
          lastMessageAt: new Date("2026-08-21T12:00:00.000Z"),
        },
      });
      const media = await prisma.mediaObject.create({
        data: {
          storageProvider: "local",
          storageKey: "existing/key",
          originalFilename: "existing.jpg",
          mimeType: "image/jpeg",
          sizeBytes: 4n,
          sha256: "a".repeat(64),
          metaMediaId: "meta-existing",
          status: MediaStatus.AVAILABLE,
        },
      });
      const original = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          whatsappMessageId: "wamid.echo-api-duplicate",
          direction: MessageDirection.OUTBOUND,
          type: MessageType.IMAGE,
          body: "authoritative API content",
          content: { kind: "system", text: "authoritative API metadata" },
          mediaObjectId: media.id,
          sentByUserId: user.id,
          status: MessageStatus.DELIVERED,
          externalTimestamp: new Date("2026-08-21T12:00:00.000Z"),
          replyToWhatsappMessageId: "wamid.api-authoritative-target",
        },
      });

      const scheduled: string[] = [];
      await processWebhookEvents(
        [
          echoEvent("wamid.echo-api-duplicate", {
            to: "551100000005",
            toUserId: "BR.ApiDuplicate",
            body: null,
            type: MessageType.STICKER,
            replyToWhatsappMessageId: "wamid.echo-must-not-overwrite-target",
            media: {
              metaMediaId: "meta-incoming-must-not-be-created",
              mimeType: "image/webp",
              sha256: null,
              filename: null,
            },
          }),
        ],
        undefined,
        (id) => scheduled.push(id),
      );

      await expect(prisma.message.findUniqueOrThrow({ where: { id: original.id } }))
        .resolves.toMatchObject({
          body: "authoritative API content",
          content: { kind: "system", text: "authoritative API metadata" },
          mediaObjectId: media.id,
          sentByUserId: user.id,
          status: MessageStatus.DELIVERED,
          replyToMessageId: null,
          replyToWhatsappMessageId: "wamid.api-authoritative-target",
        });
      await expect(
        prisma.contact.findUniqueOrThrow({ where: { id: contact.id } }),
      ).resolves.toMatchObject({
        phone: "551100000005",
        whatsappUserId: "BR.ApiDuplicate",
      });
      await expect(prisma.message.count()).resolves.toBe(1);
      await expect(prisma.mediaObject.count()).resolves.toBe(1);
      expect(scheduled).toEqual([]);
      await expect(
        prisma.webhookEvent.findUnique({
          where: {
            deduplicationKey: "message-echo:wamid.echo-api-duplicate",
          },
        }),
      ).resolves.toMatchObject({ status: WebhookStatus.PROCESSED });

      await processWebhookEvents([
        echoEvent("wamid.echo-api-duplicate-follow-up", {
          to: null,
          toUserId: "BR.ApiDuplicate",
        }),
      ]);
      await expect(prisma.contact.count()).resolves.toBe(1);
      await expect(prisma.conversation.count()).resolves.toBe(1);
      await expect(
        prisma.message.findMany({
          orderBy: { externalTimestamp: "asc" },
          select: { conversationId: true },
        }),
      ).resolves.toEqual([
        { conversationId: conversation.id },
        { conversationId: conversation.id },
      ]);
    });

    it("quarantines a duplicate wamid whose echo identity contradicts the API conversation", async () => {
      const actor = await prisma.user.create({
        data: {
          name: "Internal actor",
          email: "echo-conflicting-actor@example.test",
          passwordHash: "not-used",
          role: UserRole.ADMIN,
        },
      });
      const apiContact = await prisma.contact.create({
        data: {
          whatsappId: "551100000023",
          phone: "551100000023",
          name: "API contact",
        },
      });
      const apiConversation = await prisma.conversation.create({
        data: {
          contactId: apiContact.id,
          lastMessageAt: new Date("2026-08-21T12:00:00.000Z"),
        },
      });
      const apiMessage = await prisma.message.create({
        data: {
          conversationId: apiConversation.id,
          whatsappMessageId: "wamid.echo-api-conflicting-identity",
          direction: MessageDirection.OUTBOUND,
          type: MessageType.TEXT,
          body: "authoritative API content",
          sentByUserId: actor.id,
          status: MessageStatus.DELIVERED,
          externalTimestamp: new Date("2026-08-21T12:00:00.000Z"),
        },
      });
      await prisma.contact.create({
        data: {
          whatsappId: "551100000024",
          whatsappUserId: "BR.ConflictingApiIdentity",
          phone: null,
          name: "Conflicting BSUID contact",
        },
      });
      const domainBefore = {
        contacts: await prisma.contact.findMany({ orderBy: { id: "asc" } }),
        conversations: await prisma.conversation.findMany({
          orderBy: { id: "asc" },
        }),
        messages: await prisma.message.findMany({ orderBy: { id: "asc" } }),
      };

      await expect(
        processWebhookEvents([
          echoEvent("wamid.echo-api-conflicting-identity", {
            to: null,
            toUserId: "BR.ConflictingApiIdentity",
            body: "must not replace",
          }),
        ]),
      ).resolves.toEqual({ processed: 0, duplicates: 0, quarantined: 1 });

      await expect(
        prisma.contact.findMany({ orderBy: { id: "asc" } }),
      ).resolves.toEqual(domainBefore.contacts);
      await expect(
        prisma.conversation.findMany({ orderBy: { id: "asc" } }),
      ).resolves.toEqual(domainBefore.conversations);
      await expect(
        prisma.message.findMany({ orderBy: { id: "asc" } }),
      ).resolves.toEqual(domainBefore.messages);
      await expect(
        prisma.message.findUniqueOrThrow({ where: { id: apiMessage.id } }),
      ).resolves.toMatchObject({
        body: "authoritative API content",
        sentByUserId: actor.id,
        status: MessageStatus.DELIVERED,
      });
    });

    it("keeps newer inbound activity awaiting across a stale echo and clears on a latest echo", async () => {
      const inboundTimestamp = new Date("2026-08-21T12:02:00.000Z");
      await processWebhookEvents([
        inboundEvent("wamid.echo-order-inbound", "551100000006", inboundTimestamp),
      ]);

      const conversation = await prisma.conversation.findFirstOrThrow();
      const inbound = await prisma.message.findUniqueOrThrow({
        where: { whatsappMessageId: "wamid.echo-order-inbound" },
      });
      const manualUnreadAt = new Date("2026-08-21T12:02:30.000Z");
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { manualUnreadAt },
      });
      await expect(
        prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } }),
      ).resolves.toMatchObject({
        lastMessageAt: inboundTimestamp,
        awaitingResponseSince: inboundTimestamp,
        teamLastReadMessageId: null,
        manualUnreadAt,
      });

      await processWebhookEvents([
        echoEvent("wamid.echo-order-stale", {
          to: "551100000006",
          timestamp: new Date("2026-08-21T12:01:00.000Z"),
        }),
      ]);
      await expect(
        prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } }),
      ).resolves.toMatchObject({
        lastMessageAt: inboundTimestamp,
        awaitingResponseSince: inboundTimestamp,
        teamLastReadMessageId: null,
        manualUnreadAt,
      });

      const latestTimestamp = new Date("2026-08-21T12:03:00.000Z");
      await processWebhookEvents([
        echoEvent("wamid.echo-order-latest", {
          to: "551100000006",
          timestamp: latestTimestamp,
        }),
      ]);
      await expect(
        prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } }),
      ).resolves.toMatchObject({
        lastMessageAt: latestTimestamp,
        awaitingResponseSince: null,
        teamLastReadMessageId: inbound.id,
        teamLastReadAt: inboundTimestamp,
        manualUnreadAt,
      });
      await expect(
        prisma.conversationRead.count({ where: { conversationId: conversation.id } }),
      ).resolves.toBe(0);
      await expect(
        prisma.whatsAppReadSync.count({ where: { conversationId: conversation.id } }),
      ).resolves.toBe(0);
      await expect(
        prisma.conversationAuditEvent.count({
          where: { conversationId: conversation.id },
        }),
      ).resolves.toBe(0);
    });

    it("reconciles contact reactions and removals without changing messages or response state", async () => {
      const { conversation, message } = await seedReactionTarget();
      const awaitingBefore = conversation.awaitingResponseSince;
      const messageCount = await prisma.message.count();

      await processWebhookEvents([
        reactionEvent("wamid.contact-reaction-1", "wamid.reaction-target", "👍"),
      ]);
      await expect(prisma.messageReaction.findFirst()).resolves.toMatchObject({
        messageId: message.id,
        reactor: "CONTACT",
        emoji: "👍",
        status: "SENT",
      });

      await processWebhookEvents([
        reactionEvent(
          "wamid.contact-reaction-older",
          "wamid.reaction-target",
          "😂",
          { timestamp: new Date("2026-08-21T12:00:30.000Z") },
        ),
        reactionEvent(
          "wamid.contact-reaction-remove",
          "wamid.reaction-target",
          "",
          { timestamp: new Date("2026-08-21T12:02:00.000Z") },
        ),
      ]);
      await expect(prisma.messageReaction.findFirst()).resolves.toMatchObject({
        reactor: "CONTACT",
        emoji: "",
        providerEventId: "wamid.contact-reaction-remove",
      });
      await expect(prisma.message.count()).resolves.toBe(messageCount);
      await expect(prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } }))
        .resolves.toMatchObject({ awaitingResponseSince: awaitingBefore });
      await expect(prisma.conversationRead.count()).resolves.toBe(0);
    });

    it("reconciles official app reaction echoes using timestamp and event-id ordering", async () => {
      const { message } = await seedReactionTarget();
      const timestamp = new Date("2026-08-21T12:03:00.000Z");
      await processWebhookEvents([
        reactionEchoEvent("wamid.echo-reaction-b", "wamid.reaction-target", "❤️", { timestamp }),
      ]);
      await processWebhookEvents([
        reactionEchoEvent("wamid.echo-reaction-a", "wamid.reaction-target", "😂", { timestamp }),
        reactionEchoEvent("wamid.echo-reaction-c", "wamid.reaction-target", "🙏", { timestamp }),
      ]);

      await expect(prisma.messageReaction.findUnique({
        where: { messageId_reactor: { messageId: message.id, reactor: "BUSINESS" } },
      })).resolves.toMatchObject({
        emoji: "🙏",
        providerEventId: "wamid.echo-reaction-c",
        providerTimestamp: timestamp,
      });
    });

    it("quarantines a reaction whose customer identity differs from the target conversation", async () => {
      await seedReactionTarget();
      await expect(processWebhookEvents([
        reactionEvent("wamid.wrong-customer", "wamid.reaction-target", "👍", { from: "551199999999" }),
      ])).resolves.toEqual({ processed: 0, duplicates: 0, quarantined: 1 });
      await expect(prisma.messageReaction.count()).resolves.toBe(0);
    });

    it("marks the original message revoked when the official app reports a revoke control", async () => {
      const { message } = await seedReactionTarget();
      const revoke = controlEvent("REVOKE", "wamid.echo-control-revoke-existing");
      revoke.originalWhatsappMessageId = "wamid.reaction-target";
      revoke.toUserId = "BR.ReactionCustomer";
      await processWebhookEvents([revoke]);
      await expect(prisma.message.findUniqueOrThrow({ where: { id: message.id } }))
        .resolves.toMatchObject({ revokedAt: revoke.timestamp });
    });

    it("deduplicates edit and revoke controls without mutating message history", async () => {
      const edit = controlEvent("EDIT", "wamid.echo-control-edit");
      const revoke = controlEvent("REVOKE", "wamid.echo-control-revoke");

      await processWebhookEvents([edit, revoke]);
      const duplicate = await processWebhookEvents([edit, revoke]);

      expect(duplicate).toEqual({ processed: 0, duplicates: 2 });
      await expect(prisma.message.count()).resolves.toBe(0);
      await expect(prisma.contact.count()).resolves.toBe(0);
      await expect(
        prisma.webhookEvent.findMany({
          orderBy: { deduplicationKey: "asc" },
          select: { deduplicationKey: true, status: true },
        }),
      ).resolves.toEqual([
        {
          deduplicationKey:
            "message-echo-control:EDIT:wamid.echo-control-edit:wamid.control-original",
          status: WebhookStatus.PROCESSED,
        },
        {
          deduplicationKey:
            "message-echo-control:REVOKE:wamid.echo-control-revoke:wamid.control-original",
          status: WebhookStatus.PROCESSED,
        },
      ]);
    });
  },
);

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "WhatsApp Business App contact schema",
  () => {
    beforeEach(resetTestDatabase);

    afterAll(async () => {
      await prisma.$disconnect();
    });

    it("stores an address-book contact without creating an inbox conversation", async () => {
      const rows = await prisma.$queryRaw<Array<{ id: string }>>`
        INSERT INTO whatsapp_app_contacts
          (id, phone, full_name, active, source_timestamp, source_version_key, created_at, updated_at)
        VALUES
          (gen_random_uuid(), '556199225908', 'Contato da loja', true,
           '2026-08-23T12:00:00.000Z', 'version-key', NOW(), NOW())
        RETURNING id::text
      `;

      expect(rows).toHaveLength(1);
      await expect(prisma.contact.count()).resolves.toBe(0);
      await expect(prisma.conversation.count()).resolves.toBe(0);
    });

    it("links an add and a remove clears only the synced name", async () => {
      const contact = await prisma.contact.create({
        data: {
          whatsappId: "5561992250908",
          phone: "5561992250908",
          name: "Nome público",
          preferredName: "Nome manual",
        },
      });
      const sync = (
        action: "ADD" | "REMOVE",
        timestamp: string,
        version: string,
      ): NormalizedContactSyncBatchEvent => ({
        kind: "contactSyncBatch",
        quarantined: 0,
        items: [{
          action,
          phone: "5561992250908",
          fullName: action === "ADD" ? "Nome da agenda" : null,
          sourceTimestamp: new Date(Number(timestamp) * 1000),
          sourceTimestampRaw: timestamp,
          sourceVersionKey: version.repeat(64),
        }],
      });

      await processWebhookEvents([sync("ADD", "1787486400", "a")]);
      await expect(prisma.contact.findUniqueOrThrow({
        where: { id: contact.id },
        include: { whatsappAppContact: true },
      })).resolves.toMatchObject({
        preferredName: "Nome manual",
        whatsappAppContact: { active: true, fullName: "Nome da agenda" },
      });
      await expect(prisma.conversation.count()).resolves.toBe(0);

      await processWebhookEvents([sync("REMOVE", "1787486401", "b")]);
      await expect(prisma.contact.findUniqueOrThrow({
        where: { id: contact.id },
        include: { whatsappAppContact: true },
      })).resolves.toMatchObject({
        name: "Nome público",
        preferredName: "Nome manual",
        whatsappAppContact: { active: false, fullName: null },
      });
      await expect(prisma.conversation.count()).resolves.toBe(0);
    });
  },
);
