import "server-only";

import { Prisma } from "@/generated/prisma/client";
import {
  MediaStatus,
  MessageDirection,
  MessageStatus,
  ReactionReactor,
  ReactionStatus,
  WebhookStatus,
  type MessageStatus as MessageStatusValue,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import type { MessageBoundary } from "@/modules/conversations/boundary";
import type { MessageContent } from "@/modules/messages/content";
import { messageContentForPrisma } from "@/modules/messages/content.server";
import {
  advanceTeamReadFromBusinessEcho,
  compareBoundary,
  refreshResponseState,
} from "@/modules/conversations/shared-state";
import { publishRealtime } from "@/modules/realtime/hub";
import type { RealtimeEvent } from "@/modules/realtime/events";
import {
  reconcileConversationReplyLinks,
  reconcileReplyLinks,
} from "@/modules/messages/reply-linking.server";
import { shouldApplyMessageStatus } from "@/modules/messages/status-precedence";
import { applyMessageMutation } from "@/modules/messages/mutations";
import { applyMetaOperationalEvent } from "@/modules/meta-health/service";

import type {
  NormalizedMedia,
  NormalizedContactSyncItem,
  NormalizedMessageEchoEvent,
  NormalizedMessageEvent,
  NormalizedMessageMutationEvent,
  NormalizedMetaOperationalEvent,
  NormalizedReactionEchoEvent,
  NormalizedReactionEvent,
  NormalizedStatusEvent,
  NormalizedWebhookEvent,
  ProcessSummary,
} from "./types";

type ReservationResult = "NEW" | "RECLAIMED" | WebhookStatus;
const MISSING_STATUS_RETRY_GRACE_MS = 5 * 60_000;

type MessageRecord = {
  id: string;
  conversationId: string;
  status: MessageStatusValue;
};

type ReactionTargetRecord = MessageRecord & {
  contactWhatsappId: string | null;
  contactWhatsappUserId: string | null;
  contactPhone: string | null;
};

type ConversationMerge = {
  sourceConversationId: string;
  targetConversationId: string;
};

export type WebhookRepository = {
  reserveEvent(key: string, eventType: string): Promise<ReservationResult>;
  completeEvent(key: string): Promise<void>;
  syncAppContact(item: NormalizedContactSyncItem): Promise<boolean>;
  upsertContact(input: {
    whatsappId: string;
    phone: string;
    name: string | null;
  }): Promise<{ id: string }>;
  resolveEchoContact(input: {
    phone: string | null;
    whatsappUserId: string | null;
    expectedConversationId: string | null;
  }): Promise<{ id: string; mergedConversations: ConversationMerge[] }>;
  upsertConversation(contactId: string, timestamp: Date): Promise<{ id: string }>;
  findMessage(whatsappMessageId: string): Promise<MessageRecord | null>;
  createMedia(media: NormalizedMedia): Promise<{ id: string }>;
  createMessage(input: {
    conversationId: string;
    whatsappMessageId: string;
    type: NormalizedMessageEvent["type"];
    body: string | null;
    content: MessageContent | null;
    mediaObjectId: string | null;
    replyToWhatsappMessageId: string | null;
    direction: MessageDirection;
    status: MessageStatusValue;
    sentByUserId: string | null;
    externalTimestamp: Date;
  }): Promise<{ id: string; conversationId: string }>;
  refreshResponseState(conversationId: string): Promise<void>;
  advanceTeamReadFromBusinessEcho(
    conversationId: string,
    echoBoundary: MessageBoundary,
  ): Promise<void>;
  updateMessageStatus(
    messageId: string,
    status: NormalizedStatusEvent["status"],
    failureReason: string | null,
  ): Promise<MessageRecord>;
  findReactionTarget(whatsappMessageId: string): Promise<ReactionTargetRecord | null>;
  applyReaction(input: {
    messageId: string;
    reactor: ReactionReactor;
    emoji: string;
    providerMessageId: string;
    providerEventId: string;
    providerTimestamp: Date;
  }): Promise<"APPLIED" | "IGNORED">;
  applyMessageMutation(input: {
    messageId: string;
    providerEventId: string;
    action: "EDIT" | "REVOKE";
    providerTimestamp: Date;
    body: string | null;
    content: MessageContent | null;
  }): Promise<"APPLIED" | "IGNORED" | "MISSING">;
};

export type WebhookProcessDependencies = {
  transaction<T>(operation: (repository: WebhookRepository) => Promise<T>): Promise<T>;
  recordFailure(
    key: string,
    eventType: string,
    errorSummary: string,
  ): Promise<void>;
  quarantineEvent(
    key: string,
    eventType: string,
    errorSummary: string,
  ): Promise<void>;
  publishRealtime(event: RealtimeEvent): void;
  applyMetaOperationalEvent(event: NormalizedMetaOperationalEvent): Promise<void>;
  now?(): Date;
};

type PrismaWebhookClient = Prisma.TransactionClient;

type TransactionClient = {
  $transaction<T>(
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
    options: { isolationLevel: Prisma.TransactionIsolationLevel },
  ): Promise<T>;
};

export class WebhookProcessingError extends Error {
  constructor(
    public readonly retryable: boolean,
    public readonly recordFailure: boolean = true,
  ) {
    super("Falha ao processar webhook");
    this.name = "WebhookProcessingError";
  }
}

class WebhookIdentityConflictError extends Error {
  constructor() {
    super("Conflicting echo contact identities");
    this.name = "WebhookIdentityConflictError";
  }
}

function isPrismaError(error: unknown, codes: readonly string[]): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && codes.includes(error.code)
  );
}

async function runWebhookTransaction<T>(
  client: TransactionClient,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await client.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (!isPrismaError(error, ["P2002", "P2034"]) || attempt === 2) {
        throw error;
      }
    }
  }

  throw new Error("Unreachable transaction state");
}

export function createPrismaWebhookRepository(
  client: PrismaWebhookClient,
): WebhookRepository {
  async function mergeConversations(
    targetConversation: {
      id: string;
      responsibleUserId: string | null;
      lastMessageAt: Date;
      teamLastReadMessageId: string | null;
      teamLastReadAt: Date | null;
      manualUnreadAt: Date | null;
      manualUnreadByUserId: string | null;
    },
    sourceConversation: {
      id: string;
      responsibleUserId: string | null;
      lastMessageAt: Date;
      teamLastReadMessageId: string | null;
      teamLastReadAt: Date | null;
      manualUnreadAt: Date | null;
      manualUnreadByUserId: string | null;
    },
  ): Promise<void> {
    const sourceReads = await client.conversationRead.findMany({
      where: { conversationId: sourceConversation.id },
      select: {
        userId: true,
        lastReadAt: true,
        lastReadMessageId: true,
        lastReadMessage: {
          select: { id: true, externalTimestamp: true },
        },
      },
    });
    const targetReads = await client.conversationRead.findMany({
      where: { conversationId: targetConversation.id },
      select: {
        userId: true,
        lastReadAt: true,
        lastReadMessageId: true,
        lastReadMessage: {
          select: { id: true, externalTimestamp: true },
        },
      },
    });
    const boundaryMessages = await client.message.findMany({
      where: {
        id: {
          in: [
            targetConversation.teamLastReadMessageId,
            sourceConversation.teamLastReadMessageId,
          ].filter((id): id is string => id !== null),
        },
      },
      select: { id: true, externalTimestamp: true },
    });
    const targetReadsByUser = new Map(
      targetReads.map((read) => [read.userId, read]),
    );

    await client.message.updateMany({
      where: { conversationId: sourceConversation.id },
      data: { conversationId: targetConversation.id },
    });
    await reconcileConversationReplyLinks(client, targetConversation.id);

    for (const sourceRead of sourceReads) {
      const targetRead = targetReadsByUser.get(sourceRead.userId);
      const sourceBoundary = sourceRead.lastReadMessage ?? {
        id: null,
        externalTimestamp: sourceRead.lastReadAt,
      };
      const targetBoundary = targetRead?.lastReadMessage ??
        (targetRead
          ? { id: null, externalTimestamp: targetRead.lastReadAt }
          : null);
      const winner =
        !targetBoundary || compareBoundary(sourceBoundary, targetBoundary) > 0
          ? sourceRead
          : targetRead!;

      await client.conversationRead.upsert({
        where: {
          conversationId_userId: {
            conversationId: targetConversation.id,
            userId: sourceRead.userId,
          },
        },
        create: {
          conversationId: targetConversation.id,
          userId: sourceRead.userId,
          lastReadMessageId: winner.lastReadMessageId,
          lastReadAt: winner.lastReadAt,
        },
        update: {
          lastReadMessageId: winner.lastReadMessageId,
          lastReadAt: winner.lastReadAt,
        },
      });
    }

    await client.conversationRead.deleteMany({
      where: { conversationId: sourceConversation.id },
    });
    await client.conversationAuditEvent.updateMany({
      where: { conversationId: sourceConversation.id },
      data: { conversationId: targetConversation.id },
    });

    const boundaryMessagesById = new Map(
      boundaryMessages.map((message) => [message.id, message]),
    );
    const sharedBoundaries = [targetConversation, sourceConversation]
      .map((conversation) => {
        const pointer = conversation.teamLastReadMessageId
          ? boundaryMessagesById.get(conversation.teamLastReadMessageId)
          : null;
        if (pointer) {
          return {
            boundary: pointer,
            lastReadAt:
              conversation.teamLastReadAt ?? pointer.externalTimestamp,
          };
        }
        if (conversation.teamLastReadAt) {
          return {
            boundary: {
              id: null,
              externalTimestamp: conversation.teamLastReadAt,
            },
            lastReadAt: conversation.teamLastReadAt,
          };
        }
        return null;
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .sort((left, right) =>
        compareBoundary(left.boundary, right.boundary),
      );
    const sharedBoundary = sharedBoundaries.at(-1) ?? null;
    const manualUnreadSourceIsNewer =
      sourceConversation.manualUnreadAt !== null &&
      (targetConversation.manualUnreadAt === null ||
        sourceConversation.manualUnreadAt > targetConversation.manualUnreadAt);

    await client.conversation.update({
      where: { id: targetConversation.id },
      data: {
        responsibleUserId:
          targetConversation.responsibleUserId ??
          sourceConversation.responsibleUserId,
        lastMessageAt:
          targetConversation.lastMessageAt > sourceConversation.lastMessageAt
            ? targetConversation.lastMessageAt
            : sourceConversation.lastMessageAt,
        teamLastReadMessageId: sharedBoundary?.boundary.id ?? null,
        teamLastReadAt: sharedBoundary?.lastReadAt ?? null,
        manualUnreadAt: manualUnreadSourceIsNewer
          ? sourceConversation.manualUnreadAt
          : targetConversation.manualUnreadAt,
        manualUnreadByUserId: manualUnreadSourceIsNewer
          ? sourceConversation.manualUnreadByUserId
          : targetConversation.manualUnreadByUserId,
      },
    });
    await client.conversation.delete({
      where: { id: sourceConversation.id },
    });
    await refreshResponseState(client, targetConversation.id);
  }

  async function resolveEchoContact(input: {
    phone: string | null;
    whatsappUserId: string | null;
    expectedConversationId: string | null;
  }): Promise<{ id: string; mergedConversations: ConversationMerge[] }> {
    const identities: Prisma.ContactWhereInput[] = [];
    if (input.phone) {
      identities.push({ phone: input.phone }, { whatsappId: input.phone });
    }
    if (input.whatsappUserId) {
      identities.push({ whatsappUserId: input.whatsappUserId });
    }
    if (input.expectedConversationId) {
      identities.push({ conversation: { id: input.expectedConversationId } });
    }

    const select = {
      id: true,
      whatsappId: true,
      whatsappUserId: true,
      phone: true,
      whatsappAppContactId: true,
      conversation: {
        select: {
          id: true,
          responsibleUserId: true,
          lastMessageAt: true,
          teamLastReadMessageId: true,
          teamLastReadAt: true,
          manualUnreadAt: true,
          manualUnreadByUserId: true,
        },
      },
    } as const;
    const contacts = await client.contact.findMany({
      where: { OR: identities },
      select,
    });
    if (contacts.length === 0) {
      const appContact = input.phone
        ? await client.whatsAppAppContact.findFirst({
            where: { phone: input.phone, active: true },
            select: { id: true },
          })
        : null;
      const created = await client.contact.create({
        data: {
          whatsappId: input.phone,
          whatsappUserId: input.whatsappUserId,
          phone: input.phone,
          name: input.phone ?? "WhatsApp",
          whatsappAppContactId: appContact?.id ?? null,
        },
        select: { id: true },
      });
      return { ...created, mergedConversations: [] };
    }

    const phoneIdentities = new Set<string>();
    const whatsappUserIds = new Set<string>();
    if (input.phone) phoneIdentities.add(input.phone);
    if (input.whatsappUserId) whatsappUserIds.add(input.whatsappUserId);
    for (const contact of contacts) {
      if (contact.phone) phoneIdentities.add(contact.phone);
      if (contact.whatsappUserId) whatsappUserIds.add(contact.whatsappUserId);
      const whatsappIdIsCanonicalUserId =
        contact.whatsappId !== null &&
        (contact.whatsappId === contact.whatsappUserId ||
          contact.whatsappId === input.whatsappUserId);
      if (contact.whatsappId && !whatsappIdIsCanonicalUserId) {
        phoneIdentities.add(contact.whatsappId);
      }
    }
    if (phoneIdentities.size > 1 || whatsappUserIds.size > 1) {
      throw new WebhookIdentityConflictError();
    }

    const expectedCandidates = input.expectedConversationId
      ? contacts.filter(
          (contact) => contact.conversation?.id === input.expectedConversationId,
        )
      : [];
    const canonicalPhoneCandidates = input.phone
      ? contacts.filter((contact) => contact.phone === input.phone)
      : [];
    const legacyPhoneCandidates = input.phone
      ? contacts.filter((contact) => contact.whatsappId === input.phone)
      : [];
    const bsuidCandidates = input.whatsappUserId
      ? contacts.filter(
          (contact) => contact.whatsappUserId === input.whatsappUserId,
        )
      : [];
    const target =
      expectedCandidates[0] ??
      canonicalPhoneCandidates[0] ??
      legacyPhoneCandidates[0] ??
      bsuidCandidates[0];
    if (!target || expectedCandidates.length > 1) {
      throw new WebhookIdentityConflictError();
    }

    let targetConversation = target.conversation;
    let targetAppContactId = target.whatsappAppContactId;
    const mergedConversations: ConversationMerge[] = [];
    const sources = contacts
      .filter((contact) => contact.id !== target.id)
      .sort((left, right) => left.id.localeCompare(right.id));
    for (const source of sources) {
      if (targetConversation && source.conversation) {
        await mergeConversations(targetConversation, source.conversation);
        mergedConversations.push({
          sourceConversationId: source.conversation.id,
          targetConversationId: targetConversation.id,
        });
        targetConversation = await client.conversation.findUniqueOrThrow({
          where: { id: targetConversation.id },
          select: {
            id: true,
            responsibleUserId: true,
            lastMessageAt: true,
            teamLastReadMessageId: true,
            teamLastReadAt: true,
            manualUnreadAt: true,
            manualUnreadByUserId: true,
          },
        });
      } else if (source.conversation) {
        await client.conversation.update({
          where: { id: source.conversation.id },
          data: { contactId: target.id },
        });
        targetConversation = source.conversation;
      }
      if (!targetAppContactId && source.whatsappAppContactId) {
        await client.contact.update({
          where: { id: source.id },
          data: { whatsappAppContactId: null },
        });
        targetAppContactId = source.whatsappAppContactId;
      }
      await client.contact.delete({ where: { id: source.id } });
    }

    const activeAppContact = input.phone
      ? await client.whatsAppAppContact.findFirst({
          where: { phone: input.phone, active: true },
          select: { id: true },
        })
      : null;

    const updated = await client.contact.update({
      where: { id: target.id },
      data: {
        whatsappId: target.whatsappId ?? input.phone,
        phone: target.phone ?? input.phone,
        whatsappUserId: target.whatsappUserId ?? input.whatsappUserId,
        whatsappAppContactId: targetAppContactId ?? activeAppContact?.id ?? null,
      },
      select: { id: true },
    });
    return { ...updated, mergedConversations };
  }

  return {
    async reserveEvent(key, eventType) {
      const existing = await client.webhookEvent.findUnique({
        where: { deduplicationKey: key },
        select: { id: true, status: true },
      });

      if (!existing) {
        await client.webhookEvent.create({
          data: {
            deduplicationKey: key,
            eventType,
            status: WebhookStatus.PROCESSING,
          },
        });
        return "NEW";
      }

      if (existing.status === WebhookStatus.FAILED) {
        await client.webhookEvent.update({
          where: { id: existing.id },
          data: {
            status: WebhookStatus.PROCESSING,
            errorSummary: null,
            processedAt: null,
          },
        });
        return "RECLAIMED";
      }

      return existing.status;
    },
    async completeEvent(key) {
      await client.webhookEvent.update({
        where: { deduplicationKey: key },
        data: {
          status: WebhookStatus.PROCESSED,
          errorSummary: null,
          processedAt: new Date(),
        },
      });
    },
    async syncAppContact(item) {
      const existing = await client.whatsAppAppContact.findUnique({
        where: { phone: item.phone },
      });
      const incomingRank = item.action === "REMOVE" ? 1 : 0;
      const existingRank = existing?.active === false ? 1 : 0;
      const ordering = existing
        ? item.sourceTimestamp.getTime() - existing.sourceTimestamp.getTime() ||
          incomingRank - existingRank ||
          item.sourceVersionKey.localeCompare(existing.sourceVersionKey)
        : 1;

      if (
        (existing && ordering <= 0) ||
        (item.action === "REMOVE" &&
          item.sourceTimestamp.getTime() === 0 &&
          existing !== null &&
          existing.sourceTimestamp.getTime() > 0)
      ) {
        return false;
      }

      const stored = existing
        ? await client.whatsAppAppContact.update({
            where: { id: existing.id },
            data: {
              fullName: item.action === "ADD" ? item.fullName : null,
              active: item.action === "ADD",
              sourceTimestamp: item.sourceTimestamp,
              sourceVersionKey: item.sourceVersionKey,
            },
            select: { id: true },
          })
        : await client.whatsAppAppContact.create({
            data: {
              phone: item.phone,
              fullName: item.action === "ADD" ? item.fullName : null,
              active: item.action === "ADD",
              sourceTimestamp: item.sourceTimestamp,
              sourceVersionKey: item.sourceVersionKey,
            },
            select: { id: true },
          });

      if (item.action === "ADD") {
        await client.contact.updateMany({
          where: { phone: item.phone, whatsappAppContactId: null },
          data: { whatsappAppContactId: stored.id },
        });
      }

      return true;
    },
    async upsertContact({ whatsappId, phone, name }) {
      const appContact = await client.whatsAppAppContact.findFirst({
        where: { phone, active: true },
        select: { id: true },
      });
      return client.contact.upsert({
        where: { whatsappId },
        create: {
          whatsappId,
          phone,
          name: name ?? phone,
          whatsappAppContactId: appContact?.id ?? null,
        },
        update: {
          ...(name ? { name } : {}),
          ...(appContact ? { whatsappAppContactId: appContact.id } : {}),
        },
        select: { id: true },
      });
    },
    resolveEchoContact,
    async upsertConversation(contactId, timestamp) {
      const conversation = await client.conversation.upsert({
        where: { contactId },
        create: { contactId, lastMessageAt: timestamp },
        update: {},
        select: { id: true },
      });

      await client.conversation.updateMany({
        where: { id: conversation.id, lastMessageAt: { lt: timestamp } },
        data: { lastMessageAt: timestamp },
      });

      return conversation;
    },
    findMessage(whatsappMessageId) {
      return client.message.findUnique({
        where: { whatsappMessageId },
        select: { id: true, conversationId: true, status: true },
      });
    },
    createMedia(media) {
      return client.mediaObject.create({
        data: {
          storageProvider: "local",
          storageKey: null,
          originalFilename: media.filename ?? "",
          mimeType: media.mimeType,
          sizeBytes: 0n,
          sha256: media.sha256,
          metaMediaId: media.metaMediaId,
          status: MediaStatus.PENDING,
        },
        select: { id: true },
      });
    },
    async createMessage(input) {
      const replyTarget = input.replyToWhatsappMessageId
        ? await client.message.findFirst({
            where: {
              conversationId: input.conversationId,
              whatsappMessageId: input.replyToWhatsappMessageId,
            },
            select: { id: true },
          })
        : null;
      const message = await client.message.create({
        data: {
          conversationId: input.conversationId,
          whatsappMessageId: input.whatsappMessageId,
          type: input.type,
          body: input.body,
          content: messageContentForPrisma(input.content),
          mediaObjectId: input.mediaObjectId,
          replyToMessageId: replyTarget?.id ?? null,
          replyToWhatsappMessageId: input.replyToWhatsappMessageId,
          sentByUserId: input.sentByUserId,
          status: input.status,
          direction: input.direction,
          externalTimestamp: input.externalTimestamp,
        },
        select: { id: true, conversationId: true },
      });
      await reconcileReplyLinks(client, {
        conversationId: input.conversationId,
        messageId: message.id,
        whatsappMessageId: input.whatsappMessageId,
      });
      return message;
    },
    refreshResponseState(conversationId) {
      return refreshResponseState(client, conversationId);
    },
    async advanceTeamReadFromBusinessEcho(conversationId, echoBoundary) {
      await advanceTeamReadFromBusinessEcho(
        client,
        conversationId,
        echoBoundary,
      );
    },
    updateMessageStatus(messageId, status, failureReason) {
      return client.message.update({
        where: { id: messageId },
        data: { status, failureReason },
        select: { id: true, conversationId: true, status: true },
      });
    },
    findReactionTarget(whatsappMessageId) {
      return client.message.findUnique({
        where: { whatsappMessageId },
        select: {
          id: true,
          conversationId: true,
          status: true,
          conversation: {
            select: {
              contact: {
                select: {
                  whatsappId: true,
                  whatsappUserId: true,
                  phone: true,
                },
              },
            },
          },
        },
      }).then((row) => row ? ({
        id: row.id,
        conversationId: row.conversationId,
        status: row.status,
        contactWhatsappId: row.conversation.contact.whatsappId,
        contactWhatsappUserId: row.conversation.contact.whatsappUserId,
        contactPhone: row.conversation.contact.phone,
      }) : null);
    },
    async applyReaction(input) {
      const current = await client.messageReaction.findUnique({
        where: {
          messageId_reactor: {
            messageId: input.messageId,
            reactor: input.reactor,
          },
        },
        select: {
          providerTimestamp: true,
          providerEventId: true,
          clientRequestId: true,
          sentByUserId: true,
          providerMessageId: true,
        },
      });
      if (current?.providerTimestamp) {
        const timestampOrder = input.providerTimestamp.getTime() - current.providerTimestamp.getTime();
        if (
          timestampOrder < 0 ||
          (timestampOrder === 0 && input.providerEventId <= (current.providerEventId ?? ""))
        ) {
          return "IGNORED";
        }
      }
      const preserveSender =
        input.reactor === ReactionReactor.BUSINESS &&
        current?.providerMessageId === input.providerMessageId
          ? current.sentByUserId
          : null;
      await client.messageReaction.upsert({
        where: {
          messageId_reactor: {
            messageId: input.messageId,
            reactor: input.reactor,
          },
        },
        create: {
          messageId: input.messageId,
          reactor: input.reactor,
          emoji: input.emoji,
          status: ReactionStatus.SENT,
          providerMessageId: input.providerMessageId,
          providerEventId: input.providerEventId,
          providerTimestamp: input.providerTimestamp,
          sentByUserId: preserveSender,
        },
        update: {
          emoji: input.emoji,
          status: ReactionStatus.SENT,
          clientRequestId: preserveSender ? current?.clientRequestId : null,
          providerMessageId: input.providerMessageId,
          providerEventId: input.providerEventId,
          providerTimestamp: input.providerTimestamp,
          providerAttemptedAt: null,
          sentByUserId: preserveSender,
          failureReason: null,
        },
      });
      return "APPLIED";
    },
    applyMessageMutation(input) {
      return applyMessageMutation(client, input);
    },
  };
}

const defaultDependencies: WebhookProcessDependencies = {
  transaction: (operation) =>
    runWebhookTransaction(prisma, (transaction) =>
      operation(createPrismaWebhookRepository(transaction)),
    ),
  recordFailure: (key, eventType, errorSummary) =>
    runWebhookTransaction(prisma, async (transaction) => {
      const existing = await transaction.webhookEvent.findUnique({
        where: { deduplicationKey: key },
        select: { id: true, status: true },
      });

      if (existing?.status === WebhookStatus.PROCESSED) {
        return;
      }

      if (existing) {
        await transaction.webhookEvent.update({
          where: { id: existing.id },
          data: {
            eventType,
            status: WebhookStatus.FAILED,
            errorSummary,
            processedAt: null,
          },
        });
        return;
      }

      await transaction.webhookEvent.create({
        data: {
          deduplicationKey: key,
          eventType,
          status: WebhookStatus.FAILED,
          errorSummary,
        },
      });
    }),
  quarantineEvent: (key, eventType, errorSummary) =>
    runWebhookTransaction(prisma, async (transaction) => {
      const existing = await transaction.webhookEvent.findUnique({
        where: { deduplicationKey: key },
        select: { id: true, status: true },
      });

      if (existing?.status === WebhookStatus.PROCESSED) {
        return;
      }

      if (existing) {
        await transaction.webhookEvent.update({
          where: { id: existing.id },
          data: {
            eventType,
            status: WebhookStatus.PROCESSED,
            errorSummary,
            processedAt: new Date(),
          },
        });
        return;
      }

      await transaction.webhookEvent.create({
        data: {
          deduplicationKey: key,
          eventType,
          status: WebhookStatus.PROCESSED,
          errorSummary,
          processedAt: new Date(),
        },
      });
    }),
  publishRealtime,
  applyMetaOperationalEvent,
};

function deduplicationKey(
  event: NormalizedWebhookEvent,
): string {
  switch (event.kind) {
    case "message":
      return `message:${event.whatsappMessageId}`;
    case "status":
      return `status:${event.whatsappMessageId}:${event.status}:${event.timestampRaw}`;
    case "messageEcho":
      return `message-echo:${event.whatsappMessageId}`;
    case "messageMutation":
      return `message-mutation:${event.providerEventId}`;
    case "reaction":
      return `reaction:${event.whatsappMessageId}`;
    case "reactionEcho":
      return `reaction-echo:${event.whatsappMessageId}`;
    case "metaOperational":
      return event.deduplicationKey;
    case "contactSyncBatch":
      return `contact-sync-batch:${event.items[0]?.sourceVersionKey ?? "empty"}`;
  }
}

function safeErrorSummary(error: unknown): string {
  const name =
    error !== null && typeof error === "object" && "name" in error
      ? String(error.name).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64)
      : "Unknown";
  return `processing_error:${name || "Unknown"}`;
}

async function processMessage(
  event: NormalizedMessageEvent,
  key: string,
  repository: WebhookRepository,
): Promise<{
  duplicate: boolean;
  realtime: readonly RealtimeEvent[];
  pendingMediaId: string | null;
}> {
  const existing = await repository.findMessage(event.whatsappMessageId);

  if (existing) {
    await repository.completeEvent(key);
    return { duplicate: true, realtime: [], pendingMediaId: null };
  }

  const contact = await repository.upsertContact({
    whatsappId: event.from,
    phone: event.from,
    name: event.contactName,
  });
  const conversation = await repository.upsertConversation(contact.id, event.timestamp);
  const media = event.media ? await repository.createMedia(event.media) : null;
  const message = await repository.createMessage({
    conversationId: conversation.id,
    whatsappMessageId: event.whatsappMessageId,
    type: event.type,
    body: event.body,
    content: event.content,
    mediaObjectId: media?.id ?? null,
    replyToWhatsappMessageId: event.replyToWhatsappMessageId,
    direction: MessageDirection.INBOUND,
    status: MessageStatus.RECEIVED,
    sentByUserId: null,
    externalTimestamp: event.timestamp,
  });
  await repository.refreshResponseState(conversation.id);
  await repository.completeEvent(key);

  return {
    duplicate: false,
    pendingMediaId: media?.id ?? null,
    realtime: [{
      type: "message.created",
      conversationId: message.conversationId,
      messageId: message.id,
    }],
  };
}

async function processMessageEcho(
  event: NormalizedMessageEchoEvent,
  key: string,
  repository: WebhookRepository,
): Promise<{
  duplicate: boolean;
  realtime: readonly RealtimeEvent[];
  pendingMediaId: string | null;
}> {
  const existing = await repository.findMessage(event.whatsappMessageId);
  const contact = await repository.resolveEchoContact({
    phone: event.to,
    whatsappUserId: event.toUserId,
    expectedConversationId: existing?.conversationId ?? null,
  });
  const mergeRealtime: RealtimeEvent[] = contact.mergedConversations.map(
    ({ sourceConversationId, targetConversationId }) => ({
      type: "conversation.merged",
      sourceConversationId,
      targetConversationId,
    }),
  );

  if (existing) {
    await repository.completeEvent(key);
    return { duplicate: true, realtime: mergeRealtime, pendingMediaId: null };
  }

  const conversation = await repository.upsertConversation(
    contact.id,
    event.timestamp,
  );
  const media = event.media ? await repository.createMedia(event.media) : null;
  const message = await repository.createMessage({
    conversationId: conversation.id,
    whatsappMessageId: event.whatsappMessageId,
    type: event.type,
    body: event.body,
    content: event.content,
    mediaObjectId: media?.id ?? null,
    replyToWhatsappMessageId: event.replyToWhatsappMessageId,
    direction: MessageDirection.OUTBOUND,
    status: MessageStatus.SENT,
    sentByUserId: null,
    externalTimestamp: event.timestamp,
  });
  await repository.refreshResponseState(conversation.id);
  await repository.advanceTeamReadFromBusinessEcho(conversation.id, {
    id: message.id,
    externalTimestamp: event.timestamp,
  });
  await repository.completeEvent(key);

  return {
    duplicate: false,
    pendingMediaId: media?.id ?? null,
    realtime: [
      ...mergeRealtime,
      {
        type: "message.created",
        conversationId: message.conversationId,
        messageId: message.id,
      },
    ],
  };
}

function numericIdentity(value: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  return digits || null;
}

function reactionIdentityMatches(
  target: ReactionTargetRecord,
  event: NormalizedReactionEvent | NormalizedReactionEchoEvent | NormalizedMessageMutationEvent,
): boolean {
  const phoneIdentities = new Set(
    [target.contactWhatsappId, target.contactPhone]
      .map(numericIdentity)
      .filter((value): value is string => value !== null),
  );
  if (event.kind === "reaction") {
    return phoneIdentities.has(numericIdentity(event.from) ?? "");
  }
  const phone = event.kind === "messageMutation" ? event.identity.phone : event.to;
  const whatsappUserId = event.kind === "messageMutation"
    ? event.identity.whatsappUserId
    : event.toUserId;
  const phoneMatches = phone
    ? phoneIdentities.has(numericIdentity(phone) ?? "")
    : false;
  const userMatches = whatsappUserId
    ? whatsappUserId === target.contactWhatsappUserId
    : false;
  return phoneMatches || userMatches;
}

async function processReaction(
  event: NormalizedReactionEvent | NormalizedReactionEchoEvent,
  key: string,
  repository: WebhookRepository,
  now: Date,
): Promise<{ duplicate: boolean; realtime: readonly RealtimeEvent[]; pendingMediaId: null }> {
  const target = await repository.findReactionTarget(event.targetWhatsappMessageId);
  if (!target) {
    if (Math.abs(now.getTime() - event.timestamp.getTime()) <= MISSING_STATUS_RETRY_GRACE_MS) {
      throw new WebhookProcessingError(true);
    }
    await repository.completeEvent(key);
    return { duplicate: false, realtime: [], pendingMediaId: null };
  }
  if (!reactionIdentityMatches(target, event)) throw new WebhookIdentityConflictError();

  const applied = await repository.applyReaction({
    messageId: target.id,
    reactor: event.kind === "reaction" ? ReactionReactor.CONTACT : ReactionReactor.BUSINESS,
    emoji: event.emoji,
    providerMessageId: event.whatsappMessageId,
    providerEventId: event.whatsappMessageId,
    providerTimestamp: event.timestamp,
  });
  await repository.completeEvent(key);
  return {
    duplicate: applied === "IGNORED",
    realtime: applied === "APPLIED"
      ? [{ type: "reaction.updated", conversationId: target.conversationId, messageId: target.id }]
      : [],
    pendingMediaId: null,
  };
}

async function processMessageMutation(
  event: NormalizedMessageMutationEvent,
  key: string,
  repository: WebhookRepository,
  now: Date,
): Promise<{
  duplicate: boolean;
  realtime: readonly RealtimeEvent[];
  pendingMediaId: string | null;
}> {
  const target = await repository.findReactionTarget(event.originalWhatsappMessageId);
  if (!target) {
    if (Math.abs(now.getTime() - event.timestamp.getTime()) <= MISSING_STATUS_RETRY_GRACE_MS) {
      throw new WebhookProcessingError(true);
    }
    await repository.completeEvent(key);
    return { duplicate: false, realtime: [], pendingMediaId: null };
  }
  if (!reactionIdentityMatches(target, event)) throw new WebhookIdentityConflictError();
  const applied = await repository.applyMessageMutation({
    messageId: target.id,
    providerEventId: event.providerEventId,
    action: event.action,
    providerTimestamp: event.timestamp,
    body: event.body,
    content: event.content,
  });
  if (applied === "MISSING") throw new WebhookProcessingError(true);
  await repository.completeEvent(key);
  return {
    duplicate: applied === "IGNORED",
    realtime: applied === "APPLIED"
      ? [{ type: "message.updated", conversationId: target.conversationId, messageId: target.id }]
      : [],
    pendingMediaId: null,
  };
}

async function processStatus(
  event: NormalizedStatusEvent,
  key: string,
  repository: WebhookRepository,
  now: Date,
): Promise<{ duplicate: boolean; realtime: readonly RealtimeEvent[]; pendingMediaId: string | null }> {
  const message = await repository.findMessage(event.whatsappMessageId);

  if (!message) {
    if (Math.abs(now.getTime() - event.timestamp.getTime()) <= MISSING_STATUS_RETRY_GRACE_MS) {
      throw new WebhookProcessingError(true);
    }
    await repository.completeEvent(key);
    return { duplicate: false, realtime: [], pendingMediaId: null };
  }

  let realtime: RealtimeEvent[] = [];

  if (shouldApplyMessageStatus(message.status, event.status)) {
    const updated = await repository.updateMessageStatus(
      message.id,
      event.status,
      event.failureReason,
    );
    realtime = [{
      type: "message.status",
      conversationId: updated.conversationId,
      messageId: updated.id,
    }];
  }

  await repository.completeEvent(key);
  return { duplicate: false, realtime, pendingMediaId: null };
}

export async function processWebhookEvents(
  events: readonly NormalizedWebhookEvent[],
  dependencies: WebhookProcessDependencies = defaultDependencies,
  onMediaCommitted?: (mediaId: string) => void,
): Promise<ProcessSummary> {
  const summary: ProcessSummary = { processed: 0, duplicates: 0 };

  for (const event of events) {
    if (event.kind === "contactSyncBatch") {
      summary.quarantined = (summary.quarantined ?? 0) + event.quarantined;
      let applied = false;

      for (let offset = 0; offset < event.items.length; offset += 250) {
        const chunk = event.items.slice(offset, offset + 250);
        const chunkOutcome = await dependencies.transaction(async (repository) => {
          let processed = 0;
          let duplicates = 0;
          let changed = false;

          for (const item of chunk) {
            const key = `contact-sync:${item.sourceVersionKey}`;
            const reservation = await repository.reserveEvent(key, event.kind);
            if (reservation === WebhookStatus.PROCESSED) {
              duplicates += 1;
              continue;
            }
            if (reservation === WebhookStatus.PROCESSING) {
              throw new WebhookProcessingError(true, false);
            }
            changed = (await repository.syncAppContact(item)) || changed;
            await repository.completeEvent(key);
            processed += 1;
          }

          return { processed, duplicates, changed };
        });

        summary.processed += chunkOutcome.processed;
        summary.duplicates += chunkOutcome.duplicates;
        applied = applied || chunkOutcome.changed;
      }

      if (applied) {
        try {
          dependencies.publishRealtime({
            type: "contacts.synced",
            revision: event.items.at(-1)?.sourceVersionKey ?? "empty",
          });
        } catch {
          // Database state is authoritative; clients resynchronize after reconnecting.
        }
      }
      continue;
    }

    const key = deduplicationKey(event);
    const now = dependencies.now?.() ?? new Date();
    let outcome: {
      duplicate: boolean;
      realtime: readonly RealtimeEvent[];
      pendingMediaId: string | null;
    };

    try {
      if (event.kind === "metaOperational") {
        const reservation = await dependencies.transaction((repository) =>
          repository.reserveEvent(key, event.kind),
        );
        if (reservation === WebhookStatus.PROCESSED) {
          outcome = { duplicate: true, realtime: [], pendingMediaId: null };
        } else {
          if (reservation === WebhookStatus.PROCESSING) {
            throw new WebhookProcessingError(true, false);
          }
          await dependencies.applyMetaOperationalEvent(event);
          await dependencies.transaction(async (repository) => {
            await repository.completeEvent(key);
          });
          outcome = {
            duplicate: false,
            realtime: [{ type: "meta-health.updated" }],
            pendingMediaId: null,
          };
        }
      } else outcome = await dependencies.transaction(async (repository) => {
        const reservation = await repository.reserveEvent(key, event.kind);

        if (reservation === WebhookStatus.PROCESSED) {
          return { duplicate: true, realtime: [], pendingMediaId: null };
        }

        if (reservation === WebhookStatus.PROCESSING) {
          throw new WebhookProcessingError(true, false);
        }

        switch (event.kind) {
          case "message":
            return processMessage(event, key, repository);
          case "status":
            return processStatus(event, key, repository, now);
          case "messageEcho":
            return processMessageEcho(event, key, repository);
          case "messageMutation":
            return processMessageMutation(event, key, repository, now);
          case "reaction":
          case "reactionEcho":
            return processReaction(event, key, repository, now);
        }
      });
    } catch (error) {
      if (error instanceof WebhookIdentityConflictError) {
        try {
          await dependencies.quarantineEvent(
            key,
            event.kind,
            "quarantined:identity_conflict",
          );
        } catch {
          throw new WebhookProcessingError(true, false);
        }
        summary.quarantined = (summary.quarantined ?? 0) + 1;
        continue;
      }

      const processingError =
        error instanceof WebhookProcessingError
          ? error
          : new WebhookProcessingError(true);

      if (processingError.recordFailure) {
        try {
          await dependencies.recordFailure(key, event.kind, safeErrorSummary(error));
        } catch {
          // The original processing failure remains the retry signal.
        }
      }

      throw processingError;
    }

    if (outcome.duplicate) {
      summary.duplicates += 1;
    } else {
      summary.processed += 1;

      if (outcome.pendingMediaId && onMediaCommitted) {
        try {
          onMediaCommitted(outcome.pendingMediaId);
        } catch {
          // The committed media record remains available for on-demand recovery.
        }
      }
    }

    for (const realtime of outcome.realtime) {
      try {
        dependencies.publishRealtime(realtime);
      } catch {
        // Database state is authoritative; clients resynchronize after reconnecting.
      }
    }
  }

  return summary;
}
