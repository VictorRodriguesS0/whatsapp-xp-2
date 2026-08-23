import "server-only";

import { MessageDirection } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { compareBoundary } from "@/modules/conversations/boundary";

import type {
  ReadBoundary,
  ReadReceiptClaim,
  ReadReceiptFailure,
  ReadReceiptRepository,
  ReadSyncClient,
} from "./types";

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
    },
  });
  return eligible.id;
}

type CandidateRow = {
  conversation_id: string;
  target_message_id: string;
  whatsapp_message_id: string;
  external_timestamp: Date;
  attempt_count: number;
};

type ClaimInput = {
  now: Date;
  leaseId: string;
  leaseUntil: Date;
  conversationId?: string;
};

async function claimDue(input: ClaimInput): Promise<ReadReceiptClaim | null> {
  return prisma.$transaction(async (transaction) => {
    const eligibilityFloor = new Date(input.now.getTime() - THIRTY_DAYS_MS);
    await transaction.$executeRaw`
      UPDATE whatsapp_read_sync wrs
      SET next_attempt_at = NULL,
          failed_target_message_id = wrs.target_message_id,
          last_failure_kind = 'REJECTED'::"ReadReceiptFailureKind",
          lease_id = NULL,
          lease_until = NULL,
          updated_at = ${input.now}
      FROM messages target
      WHERE target.id = wrs.target_message_id
        AND wrs.next_attempt_at IS NOT NULL
        AND target.external_timestamp < ${eligibilityFloor}
    `;

    const rows = input.conversationId
      ? await transaction.$queryRaw<CandidateRow[]>`
          SELECT wrs.conversation_id,
                 wrs.target_message_id,
                 target.whatsapp_message_id,
                 target.external_timestamp,
                 wrs.attempt_count
          FROM whatsapp_read_sync wrs
          JOIN messages target ON target.id = wrs.target_message_id
          WHERE wrs.conversation_id = ${input.conversationId}::uuid
            AND wrs.next_attempt_at <= ${input.now}
            AND (wrs.lease_until IS NULL OR wrs.lease_until <= ${input.now})
            AND wrs.target_message_id IS DISTINCT FROM wrs.confirmed_message_id
            AND wrs.target_message_id IS DISTINCT FROM wrs.failed_target_message_id
            AND target.whatsapp_message_id IS NOT NULL
            AND target.revoked_at IS NULL
            AND target.external_timestamp >= ${eligibilityFloor}
          ORDER BY wrs.next_attempt_at ASC, wrs.updated_at ASC
          FOR UPDATE OF wrs SKIP LOCKED
          LIMIT 1
        `
      : await transaction.$queryRaw<CandidateRow[]>`
          SELECT wrs.conversation_id,
                 wrs.target_message_id,
                 target.whatsapp_message_id,
                 target.external_timestamp,
                 wrs.attempt_count
          FROM whatsapp_read_sync wrs
          JOIN messages target ON target.id = wrs.target_message_id
          WHERE wrs.next_attempt_at <= ${input.now}
            AND (wrs.lease_until IS NULL OR wrs.lease_until <= ${input.now})
            AND wrs.target_message_id IS DISTINCT FROM wrs.confirmed_message_id
            AND wrs.target_message_id IS DISTINCT FROM wrs.failed_target_message_id
            AND target.whatsapp_message_id IS NOT NULL
            AND target.revoked_at IS NULL
            AND target.external_timestamp >= ${eligibilityFloor}
          ORDER BY wrs.next_attempt_at ASC, wrs.updated_at ASC
          FOR UPDATE OF wrs SKIP LOCKED
          LIMIT 1
        `;
    const candidate = rows[0];
    if (!candidate) return null;

    const updated = await transaction.whatsAppReadSync.update({
      where: { conversationId: candidate.conversation_id },
      data: {
        leaseId: input.leaseId,
        leaseUntil: input.leaseUntil,
        attemptCount: { increment: 1 },
      },
      select: { attemptCount: true },
    });

    return {
      conversationId: candidate.conversation_id,
      targetMessageId: candidate.target_message_id,
      whatsappMessageId: candidate.whatsapp_message_id,
      externalTimestamp: candidate.external_timestamp,
      attemptCount: updated.attemptCount,
      leaseId: input.leaseId,
    };
  });
}

export const prismaReadReceiptRepository: ReadReceiptRepository = {
  claimConversation(input) {
    return claimDue(input);
  },

  claimNextDue(input) {
    return claimDue(input);
  },

  async confirm(claim, confirmedAt) {
    await prisma.$transaction(async (transaction) => {
      const current = await transaction.whatsAppReadSync.findFirst({
        where: {
          conversationId: claim.conversationId,
          leaseId: claim.leaseId,
        },
        select: { targetMessageId: true },
      });
      if (!current) return;
      const newerTargetRemains = current.targetMessageId !== claim.targetMessageId;
      await transaction.whatsAppReadSync.updateMany({
        where: {
          conversationId: claim.conversationId,
          leaseId: claim.leaseId,
        },
        data: {
          confirmedMessageId: claim.targetMessageId,
          nextAttemptAt: newerTargetRemains ? confirmedAt : null,
          leaseId: null,
          leaseUntil: null,
          lastFailureKind: null,
          failedTargetMessageId: null,
        },
      });
    });
  },

  async fail(claim, failure: ReadReceiptFailure) {
    await prisma.$transaction(async (transaction) => {
      const current = await transaction.whatsAppReadSync.findFirst({
        where: {
          conversationId: claim.conversationId,
          leaseId: claim.leaseId,
        },
        select: { targetMessageId: true, nextAttemptAt: true },
      });
      if (!current) return;
      const newerTargetRemains = current.targetMessageId !== claim.targetMessageId;
      await transaction.whatsAppReadSync.updateMany({
        where: {
          conversationId: claim.conversationId,
          leaseId: claim.leaseId,
        },
        data: {
          nextAttemptAt: newerTargetRemains
            ? current.nextAttemptAt
            : failure.nextAttemptAt,
          leaseId: null,
          leaseUntil: null,
          lastFailureKind: newerTargetRemains ? null : failure.kind,
          failedTargetMessageId:
            !newerTargetRemains && failure.kind === "REJECTED"
              ? claim.targetMessageId
              : null,
        },
      });
    });
  },
};
