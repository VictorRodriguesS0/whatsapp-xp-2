// @vitest-environment node

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  MessageDirection,
  MessageStatus,
  MessageType,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { resetTestDatabase, seedReadFixture } from "@/test/database";

import { queueEligibleReadTarget } from "./repository";

const ids = {
  old: "31000000-0000-4000-8000-000000000001",
  eligible: "31000000-0000-4000-8000-000000000002",
  revoked: "31000000-0000-4000-8000-000000000003",
  localOnly: "31000000-0000-4000-8000-000000000004",
  outbound: "31000000-0000-4000-8000-000000000005",
  newer: "31000000-0000-4000-8000-000000000006",
};

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "WhatsApp read receipt target repository",
  () => {
    beforeEach(resetTestDatabase);

    afterAll(async () => {
      await prisma.$disconnect();
    });

    it("queues the newest eligible inbound message visible at the boundary", async () => {
      const { conversation, victor } = await seedReadFixture();
      const now = new Date("2026-08-23T12:00:00.000Z");
      const base = new Date("2026-08-23T10:00:00.000Z");
      const at = (minutes: number) => new Date(base.getTime() + minutes * 60_000);

      await prisma.message.createMany({
        data: [
          {
            id: ids.old,
            conversationId: conversation.id,
            whatsappMessageId: "wamid.old",
            direction: MessageDirection.INBOUND,
            type: MessageType.TEXT,
            status: MessageStatus.RECEIVED,
            externalTimestamp: new Date(now.getTime() - 31 * 24 * 60 * 60_000),
          },
          {
            id: ids.eligible,
            conversationId: conversation.id,
            whatsappMessageId: "wamid.eligible",
            direction: MessageDirection.INBOUND,
            type: MessageType.TEXT,
            status: MessageStatus.RECEIVED,
            externalTimestamp: at(0),
          },
          {
            id: ids.revoked,
            conversationId: conversation.id,
            whatsappMessageId: "wamid.revoked",
            direction: MessageDirection.INBOUND,
            type: MessageType.TEXT,
            status: MessageStatus.RECEIVED,
            revokedAt: at(2),
            externalTimestamp: at(1),
          },
          {
            id: ids.localOnly,
            conversationId: conversation.id,
            direction: MessageDirection.INBOUND,
            type: MessageType.TEXT,
            status: MessageStatus.RECEIVED,
            externalTimestamp: at(2),
          },
          {
            id: ids.outbound,
            conversationId: conversation.id,
            whatsappMessageId: "wamid.outbound",
            direction: MessageDirection.OUTBOUND,
            type: MessageType.TEXT,
            status: MessageStatus.SENT,
            sentByUserId: victor.id,
            externalTimestamp: at(3),
          },
        ],
      });

      const target = await prisma.$transaction((transaction) =>
        queueEligibleReadTarget(transaction, {
          conversationId: conversation.id,
          visibleBoundary: { id: ids.outbound, externalTimestamp: at(3) },
          now,
        }),
      );

      expect(target).toBe(ids.eligible);
      await expect(
        prisma.whatsAppReadSync.findUnique({
          where: { conversationId: conversation.id },
        }),
      ).resolves.toMatchObject({
        targetMessageId: ids.eligible,
        confirmedMessageId: null,
        attemptCount: 0,
        nextAttemptAt: now,
      });
    });

    it("never regresses an already queued target", async () => {
      const { conversation } = await seedReadFixture();
      const now = new Date("2026-08-23T12:00:00.000Z");
      const olderAt = new Date("2026-08-23T10:00:00.000Z");
      const newerAt = new Date("2026-08-23T10:01:00.000Z");
      await prisma.message.createMany({
        data: [
          {
            id: ids.eligible,
            conversationId: conversation.id,
            whatsappMessageId: "wamid.eligible",
            direction: MessageDirection.INBOUND,
            type: MessageType.TEXT,
            status: MessageStatus.RECEIVED,
            externalTimestamp: olderAt,
          },
          {
            id: ids.newer,
            conversationId: conversation.id,
            whatsappMessageId: "wamid.newer",
            direction: MessageDirection.INBOUND,
            type: MessageType.TEXT,
            status: MessageStatus.RECEIVED,
            externalTimestamp: newerAt,
          },
        ],
      });

      await prisma.$transaction((transaction) =>
        queueEligibleReadTarget(transaction, {
          conversationId: conversation.id,
          visibleBoundary: { id: ids.newer, externalTimestamp: newerAt },
          now,
        }),
      );
      const target = await prisma.$transaction((transaction) =>
        queueEligibleReadTarget(transaction, {
          conversationId: conversation.id,
          visibleBoundary: { id: ids.eligible, externalTimestamp: olderAt },
          now: new Date(now.getTime() + 1_000),
        }),
      );

      expect(target).toBe(ids.newer);
      await expect(
        prisma.whatsAppReadSync.findUniqueOrThrow({
          where: { conversationId: conversation.id },
        }),
      ).resolves.toMatchObject({ targetMessageId: ids.newer });
    });
  },
);
