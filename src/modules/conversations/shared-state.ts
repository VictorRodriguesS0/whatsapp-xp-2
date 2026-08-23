import "server-only";

import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import {
  ConversationAuditAction,
  MessageDirection,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { queueEligibleReadTarget } from "@/modules/read-receipts/repository";

import { compareBoundary, type MessageBoundary } from "./boundary";
import { runConversationTransaction } from "./service";
import type { SharedConversationStateDto } from "./types";

export type SharedStateClient = Prisma.TransactionClient;

export { compareBoundary } from "./boundary";

async function lockConversation(
  client: SharedStateClient,
  conversationId: string,
): Promise<void> {
  const locked = await client.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM conversations
    WHERE id = ${conversationId}::uuid
    FOR UPDATE
  `;

  if (locked.length === 0) {
    throw new HttpError(404, "Conversa não encontrada");
  }
}

async function assertActiveMember(
  client: SharedStateClient,
  actorUserId: string,
): Promise<void> {
  const actor = await client.user.findFirst({
    where: { id: actorUserId, active: true },
    select: { id: true },
  });

  if (!actor) {
    throw new HttpError(404, "Conversa não encontrada");
  }
}

async function upsertIndividualRead(
  client: SharedStateClient,
  actorUserId: string,
  conversationId: string,
  target: MessageBoundary,
): Promise<void> {
  const current = await client.conversationRead.findUnique({
    where: {
      conversationId_userId: { conversationId, userId: actorUserId },
    },
    select: {
      lastReadAt: true,
      lastReadMessage: { select: { id: true, externalTimestamp: true } },
    },
  });

  if (current) {
    const advances = current.lastReadMessage
      ? compareBoundary(target, current.lastReadMessage) > 0
      : target.externalTimestamp > current.lastReadAt;

    if (!advances) {
      return;
    }
  }

  await client.conversationRead.upsert({
    where: {
      conversationId_userId: { conversationId, userId: actorUserId },
    },
    create: {
      userId: actorUserId,
      conversationId,
      lastReadMessageId: target.id,
      lastReadAt: target.externalTimestamp,
    },
    update: {
      lastReadMessageId: target.id,
      lastReadAt: target.externalTimestamp,
    },
  });
}

async function sharedState(
  client: SharedStateClient,
  conversationId: string,
): Promise<SharedConversationStateDto> {
  const conversation = await client.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    select: {
      id: true,
      updatedAt: true,
      manualUnreadAt: true,
      awaitingResponseSince: true,
      teamLastReadAt: true,
      teamLastReadMessage: {
        select: { id: true, externalTimestamp: true },
      },
    },
  });
  const boundary = conversation.teamLastReadMessage;
  const unreadCount = await client.message.count({
    where: {
      conversationId,
      direction: MessageDirection.INBOUND,
      ...(boundary
        ? {
            OR: [
              { externalTimestamp: { gt: boundary.externalTimestamp } },
              {
                externalTimestamp: boundary.externalTimestamp,
                id: { gt: boundary.id },
              },
            ],
          }
        : conversation.teamLastReadAt
          ? { externalTimestamp: { gt: conversation.teamLastReadAt } }
          : {}),
    },
  });

  return {
    conversationId,
    unreadCount,
    manuallyUnread: conversation.manualUnreadAt !== null,
    manualUnreadRevision: conversation.manualUnreadAt?.toISOString() ?? null,
    awaitingResponseSince:
      conversation.awaitingResponseSince?.toISOString() ?? null,
    revision: conversation.updatedAt.toISOString(),
  };
}

export async function advanceSharedRead(
  actorUserId: string,
  conversationId: string,
  messageId: string,
  observedManualUnreadRevision: string | null = null,
  now: Date = new Date(),
  client: PrismaClient = prisma,
): Promise<SharedConversationStateDto> {
  return runConversationTransaction<
    Prisma.TransactionClient,
    SharedConversationStateDto
  >(client, async (transaction) => {
    await lockConversation(transaction, conversationId);
    await assertActiveMember(transaction, actorUserId);
    const target = await transaction.message.findFirst({
      where: { id: messageId, conversationId },
      select: { id: true, externalTimestamp: true },
    });

    if (!target) {
      throw new HttpError(400, "Mensagem não pertence à conversa");
    }

    const current = await transaction.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      select: {
        teamLastReadMessage: {
          select: { id: true, externalTimestamp: true },
        },
        teamLastReadAt: true,
        manualUnreadAt: true,
      },
    });
    const boundaryComparison = current.teamLastReadMessage
      ? compareBoundary(target, current.teamLastReadMessage)
      : current.teamLastReadAt
        ? target.externalTimestamp.getTime() - current.teamLastReadAt.getTime()
        : 1;
    const advances = boundaryComparison > 0;
    const canClearManualUnread =
      boundaryComparison >= 0 &&
      current.manualUnreadAt !== null &&
      current.manualUnreadAt.toISOString() === observedManualUnreadRevision;

    if (advances || canClearManualUnread) {
      await transaction.conversation.update({
        where: { id: conversationId },
        data: {
          ...(advances
            ? {
                teamLastReadMessageId: messageId,
                teamLastReadAt: target.externalTimestamp,
              }
            : {}),
          ...(canClearManualUnread
            ? { manualUnreadAt: null, manualUnreadByUserId: null }
            : {}),
        },
      });
    }

    await upsertIndividualRead(
      transaction,
      actorUserId,
      conversationId,
      target,
    );
    await queueEligibleReadTarget(transaction, {
      conversationId,
      visibleBoundary: target,
      now,
    });
    await transaction.conversationAuditEvent.create({
      data: {
        actorUserId,
        conversationId,
        messageId,
        action: ConversationAuditAction.READ,
      },
    });

    return sharedState(transaction, conversationId);
  });
}

export async function markSharedUnread(
  actorUserId: string,
  conversationId: string,
  client: PrismaClient = prisma,
): Promise<SharedConversationStateDto> {
  return runConversationTransaction<
    Prisma.TransactionClient,
    SharedConversationStateDto
  >(client, async (transaction) => {
    await lockConversation(transaction, conversationId);
    await assertActiveMember(transaction, actorUserId);
    const current = await transaction.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      select: { manualUnreadAt: true },
    });
    const now = Date.now();
    const manualUnreadAt = new Date(
      Math.max(now, (current.manualUnreadAt?.getTime() ?? now - 1) + 1),
    );

    await transaction.conversation.update({
      where: { id: conversationId },
      data: { manualUnreadAt, manualUnreadByUserId: actorUserId },
    });
    await transaction.conversationAuditEvent.create({
      data: {
        actorUserId,
        conversationId,
        action: ConversationAuditAction.MARKED_UNREAD,
      },
    });

    return sharedState(transaction, conversationId);
  });
}

export async function refreshResponseState(
  client: SharedStateClient,
  conversationId: string,
): Promise<void> {
  await lockConversation(client, conversationId);
  const latestOutbound = await client.message.findFirst({
    where: { conversationId, direction: MessageDirection.OUTBOUND },
    orderBy: [{ externalTimestamp: "desc" }, { id: "desc" }],
    select: { id: true, externalTimestamp: true },
  });
  const firstUnansweredInbound = await client.message.findFirst({
    where: {
      conversationId,
      direction: MessageDirection.INBOUND,
      ...(latestOutbound
        ? {
            OR: [
              { externalTimestamp: { gt: latestOutbound.externalTimestamp } },
              {
                externalTimestamp: latestOutbound.externalTimestamp,
                id: { gt: latestOutbound.id },
              },
            ],
          }
        : {}),
    },
    orderBy: [{ externalTimestamp: "asc" }, { id: "asc" }],
    select: { externalTimestamp: true },
  });

  await client.conversation.update({
    where: { id: conversationId },
    data: {
      awaitingResponseSince: firstUnansweredInbound?.externalTimestamp ?? null,
    },
  });
}
