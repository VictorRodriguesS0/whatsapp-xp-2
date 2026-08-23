import "server-only";

import { MessageDirection } from "@/generated/prisma/enums";
import { compareBoundary } from "@/modules/conversations/boundary";

import type { ReadBoundary, ReadSyncClient } from "./types";

export const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1_000;

export async function queueEligibleReadTarget(
  client: ReadSyncClient,
  input: {
    conversationId: string;
    visibleBoundary: ReadBoundary;
    now: Date;
  },
): Promise<string | null> {
  const eligible = await client.message.findFirst({
    where: {
      conversationId: input.conversationId,
      direction: MessageDirection.INBOUND,
      whatsappMessageId: { not: null },
      revokedAt: null,
      externalTimestamp: {
        gte: new Date(input.now.getTime() - THIRTY_DAYS_MS),
        lte: input.visibleBoundary.externalTimestamp,
      },
      OR: [
        { externalTimestamp: { lt: input.visibleBoundary.externalTimestamp } },
        {
          externalTimestamp: input.visibleBoundary.externalTimestamp,
          id: { lte: input.visibleBoundary.id },
        },
      ],
    },
    orderBy: [{ externalTimestamp: "desc" }, { id: "desc" }],
    select: { id: true, externalTimestamp: true },
  });
  if (!eligible) return null;

  const current = await client.whatsAppReadSync.findUnique({
    where: { conversationId: input.conversationId },
    select: {
      targetMessage: { select: { id: true, externalTimestamp: true } },
    },
  });
  if (current && compareBoundary(eligible, current.targetMessage) <= 0) {
    return current.targetMessage.id;
  }

  await client.whatsAppReadSync.upsert({
    where: { conversationId: input.conversationId },
    create: {
      conversationId: input.conversationId,
      targetMessageId: eligible.id,
      nextAttemptAt: input.now,
    },
    update: {
      targetMessageId: eligible.id,
      attemptCount: 0,
      nextAttemptAt: input.now,
      lastFailureKind: null,
      failedTargetMessageId: null,
      leaseId: null,
      leaseUntil: null,
    },
  });
  return eligible.id;
}
