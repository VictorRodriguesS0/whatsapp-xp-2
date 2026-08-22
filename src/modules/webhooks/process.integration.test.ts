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
  NormalizedMessageEchoControlEvent,
  NormalizedMessageEchoEvent,
  NormalizedMessageEvent,
} from "./types";

function echoEvent(
  whatsappMessageId: string,
  options: {
    to?: string | null;
    toUserId?: string | null;
    timestamp?: Date;
    body?: string | null;
    media?: NormalizedMessageEchoEvent["media"];
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
    type: options.media ? MessageType.IMAGE : MessageType.TEXT,
    body: options.body === undefined ? "echo body" : options.body,
    content: null,
    media: options.media ?? null,
    origin: "WHATSAPP_BUSINESS_APP",
  };
}

function inboundEvent(
  whatsappMessageId: string,
  from: string,
  timestamp: Date,
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
          mediaObjectId: media.id,
          sentByUserId: user.id,
          status: MessageStatus.DELIVERED,
          externalTimestamp: new Date("2026-08-21T12:00:00.000Z"),
        },
      });

      await processWebhookEvents([
        echoEvent("wamid.echo-api-duplicate", {
          to: "551100000005",
          toUserId: "BR.ApiDuplicate",
          body: "must not replace",
        }),
      ]);

      await expect(prisma.message.findUniqueOrThrow({ where: { id: original.id } }))
        .resolves.toMatchObject({
          body: "authoritative API content",
          mediaObjectId: media.id,
          sentByUserId: user.id,
          status: MessageStatus.DELIVERED,
        });
      await expect(
        prisma.contact.findUniqueOrThrow({ where: { id: contact.id } }),
      ).resolves.toMatchObject({
        phone: "551100000005",
        whatsappUserId: "BR.ApiDuplicate",
      });
      await expect(prisma.message.count()).resolves.toBe(1);
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
      await expect(
        prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } }),
      ).resolves.toMatchObject({
        lastMessageAt: inboundTimestamp,
        awaitingResponseSince: inboundTimestamp,
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
      });
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
