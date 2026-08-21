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
import { resetTestDatabase } from "@/test/database";

import { processWebhookEvents } from "./process";
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
      ).rejects.toMatchObject({
        message: "Falha ao processar webhook",
        retryable: true,
      });

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
        status: WebhookStatus.FAILED,
        errorSummary: "processing_error:Error",
      });
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
      await expect(prisma.message.count()).resolves.toBe(1);
      await expect(
        prisma.webhookEvent.findUnique({
          where: {
            deduplicationKey: "message-echo:wamid.echo-api-duplicate",
          },
        }),
      ).resolves.toMatchObject({ status: WebhookStatus.PROCESSED });
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
