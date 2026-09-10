import "server-only";

import { ReactionReactor, ReactionStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/http";

import type {
  BeginBusinessReactionResult,
  BusinessReactionRecord,
  ReactionRepository,
} from "./types";

const reactionSelect = {
  id: true,
  messageId: true,
  emoji: true,
  status: true,
  clientRequestId: true,
  providerMessageId: true,
  providerAttemptedAt: true,
  failureReason: true,
  sentByUser: { select: { id: true, name: true } },
} as const;

function hydrateBusinessReaction(row: {
  id: string;
  messageId: string;
  emoji: string;
  status: ReactionStatus;
  clientRequestId: string | null;
  providerMessageId: string | null;
  providerAttemptedAt: Date | null;
  failureReason: string | null;
  sentByUser: { id: string; name: string } | null;
}): BusinessReactionRecord {
  if (!row.clientRequestId || !row.sentByUser) {
    throw new Error("Invalid business reaction record");
  }
  return {
    id: row.id,
    messageId: row.messageId,
    emoji: row.emoji,
    status: row.status,
    clientRequestId: row.clientRequestId,
    providerMessageId: row.providerMessageId,
    providerAttemptedAt: row.providerAttemptedAt,
    sentByUser: row.sentByUser,
    failureReason: row.failureReason,
  };
}

function isLegacyReactionContent(content: unknown): boolean {
  if (!content || typeof content !== "object" || Array.isArray(content)) return false;
  const candidate = content as Record<string, unknown>;
  return candidate.kind === "unknown" && candidate.rawType === "reaction";
}

async function findHydratedById(reactionId: string): Promise<BusinessReactionRecord | null> {
  const row = await prisma.messageReaction.findFirst({
    where: { id: reactionId, reactor: ReactionReactor.BUSINESS },
    select: reactionSelect,
  });
  return row ? hydrateBusinessReaction(row) : null;
}

export const prismaReactionRepository: ReactionRepository = {
  async findActiveUser(userId) {
    return prisma.user.findFirst({
      where: { id: userId, active: true },
      select: { id: true, name: true },
    });
  },

  async findBusinessReactionByRequestId(clientRequestId) {
    const row = await prisma.messageReaction.findUnique({ where: { clientRequestId }, select: reactionSelect });
    return row ? hydrateBusinessReaction(row) : null;
  },

  async findTarget(messageId) {
    const row = await prisma.message.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        conversationId: true,
        whatsappMessageId: true,
        externalTimestamp: true,
        revokedAt: true,
        content: true,
        conversation: { select: { contact: { select: { phone: true } } } },
      },
    });
    if (!row) return null;
    return {
      messageId: row.id,
      conversationId: row.conversationId,
      contactPhone: row.conversation.contact.phone ?? "",
      whatsappMessageId: row.whatsappMessageId,
      externalTimestamp: row.externalTimestamp,
      revokedAt: row.revokedAt,
      isReactionMessage: isLegacyReactionContent(row.content),
    };
  },

  async beginBusinessReaction(input): Promise<BeginBusinessReactionResult> {
    return prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT 1::integer AS locked
        FROM pg_advisory_xact_lock(hashtextextended(${input.messageId}, 0))
      `;

      const reusedClientRequest = await transaction.messageReaction.findUnique({
        where: { clientRequestId: input.clientRequestId },
        select: reactionSelect,
      });
      if (reusedClientRequest) {
        if (
          reusedClientRequest.messageId !== input.messageId ||
          !reusedClientRequest.sentByUser ||
          reusedClientRequest.sentByUser.id !== input.actorId
        ) {
          throw new HttpError(409, "Identificador de reação já utilizado");
        }
        return { kind: "EXISTING", reaction: hydrateBusinessReaction(reusedClientRequest) };
      }

      const current = await transaction.messageReaction.findUnique({
        where: {
          messageId_reactor: {
            messageId: input.messageId,
            reactor: ReactionReactor.BUSINESS,
          },
        },
        select: reactionSelect,
      });
      if (current?.status === ReactionStatus.PENDING) {
        return { kind: "BUSY", reaction: hydrateBusinessReaction(current) };
      }

      const providerEmoji =
        current?.status === ReactionStatus.SENT && current.emoji === input.requestedEmoji
          ? ""
          : input.requestedEmoji;
      const pending = await transaction.messageReaction.upsert({
        where: {
          messageId_reactor: {
            messageId: input.messageId,
            reactor: ReactionReactor.BUSINESS,
          },
        },
        create: {
          messageId: input.messageId,
          reactor: ReactionReactor.BUSINESS,
          emoji: providerEmoji,
          status: ReactionStatus.PENDING,
          clientRequestId: input.clientRequestId,
          sentByUserId: input.actorId,
        },
        update: {
          emoji: providerEmoji,
          status: ReactionStatus.PENDING,
          clientRequestId: input.clientRequestId,
          providerMessageId: null,
          providerEventId: null,
          providerTimestamp: null,
          providerAttemptedAt: null,
          sentByUserId: input.actorId,
          failureReason: null,
        },
        select: reactionSelect,
      });
      return {
        kind: "STARTED",
        reaction: hydrateBusinessReaction(pending),
        providerEmoji,
      };
    });
  },

  async markProviderAttempt(reactionId, clientRequestId, attemptedAt) {
    const result = await prisma.messageReaction.updateMany({
      where: {
        id: reactionId,
        reactor: ReactionReactor.BUSINESS,
        clientRequestId,
        status: ReactionStatus.PENDING,
        providerAttemptedAt: null,
      },
      data: { providerAttemptedAt: attemptedAt },
    });
    return result.count === 1;
  },

  async markSent(reactionId, clientRequestId, providerMessageId) {
    const updated = await prisma.messageReaction.updateMany({
      where: {
        id: reactionId,
        reactor: ReactionReactor.BUSINESS,
        clientRequestId,
        status: ReactionStatus.PENDING,
        providerAttemptedAt: { not: null },
      },
      data: {
        status: ReactionStatus.SENT,
        providerMessageId,
        failureReason: null,
      },
    });
    return updated.count === 1 ? findHydratedById(reactionId) : null;
  },

  async markLocallyFailed(reactionId, clientRequestId, failureReason) {
    const updated = await prisma.messageReaction.updateMany({
      where: { id: reactionId, reactor: ReactionReactor.BUSINESS, clientRequestId, status: ReactionStatus.PENDING, providerAttemptedAt: null },
      data: { status: ReactionStatus.FAILED, failureReason },
    });
    return updated.count === 1 ? findHydratedById(reactionId) : null;
  },

  async markFailed(reactionId, clientRequestId, status, failureReason) {
    const updated = await prisma.messageReaction.updateMany({
      where: {
        id: reactionId,
        reactor: ReactionReactor.BUSINESS,
        clientRequestId,
        status: ReactionStatus.PENDING,
        providerAttemptedAt: { not: null },
      },
      data: { status, failureReason },
    });
    return updated.count === 1 ? findHydratedById(reactionId) : null;
  },

  async confirmRemoval(reactionId, clientRequestId) {
    const removed = await prisma.messageReaction.updateMany({
      where: {
        id: reactionId,
        reactor: ReactionReactor.BUSINESS,
        clientRequestId,
        emoji: "",
        status: ReactionStatus.PENDING,
        providerAttemptedAt: { not: null },
      },
      data: { status: ReactionStatus.SENT, failureReason: null },
    });
    return removed.count === 1;
  },

  findBusinessReactionById(reactionId) {
    return findHydratedById(reactionId);
  },
};
