import "server-only";

import { Prisma } from "@/generated/prisma/client";
import {
  MediaStatus,
  MessageDirection,
  MessageStatus,
  WebhookStatus,
  type MessageStatus as MessageStatusValue,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import {
  compareBoundary,
  refreshResponseState,
} from "@/modules/conversations/shared-state";
import { publishRealtime } from "@/modules/realtime/hub";
import type { RealtimeEvent } from "@/modules/realtime/events";

import type {
  NormalizedMedia,
  NormalizedMessageEchoControlEvent,
  NormalizedMessageEchoEvent,
  NormalizedMessageEvent,
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

export type WebhookRepository = {
  reserveEvent(key: string, eventType: string): Promise<ReservationResult>;
  completeEvent(key: string): Promise<void>;
  upsertContact(input: {
    whatsappId: string;
    phone: string;
    name: string | null;
  }): Promise<{ id: string }>;
  resolveEchoContact(input: {
    phone: string | null;
    whatsappUserId: string | null;
  }): Promise<{ id: string }>;
  upsertConversation(contactId: string, timestamp: Date): Promise<{ id: string }>;
  findMessage(whatsappMessageId: string): Promise<MessageRecord | null>;
  createMedia(media: NormalizedMedia): Promise<{ id: string }>;
  createMessage(input: {
    conversationId: string;
    whatsappMessageId: string;
    type: NormalizedMessageEvent["type"];
    body: string | null;
    mediaObjectId: string | null;
    direction: MessageDirection;
    status: MessageStatusValue;
    sentByUserId: string | null;
    externalTimestamp: Date;
  }): Promise<{ id: string; conversationId: string }>;
  refreshResponseState(conversationId: string): Promise<void>;
  updateMessageStatus(
    messageId: string,
    status: NormalizedStatusEvent["status"],
    failureReason: string | null,
  ): Promise<MessageRecord>;
};

export type WebhookProcessDependencies = {
  transaction<T>(operation: (repository: WebhookRepository) => Promise<T>): Promise<T>;
  recordFailure(
    key: string,
    eventType: string,
    errorSummary: string,
  ): Promise<void>;
  publishRealtime(event: RealtimeEvent): void;
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
    const [sourceReads, targetReads, boundaryMessages] = await Promise.all([
      client.conversationRead.findMany({
        where: { conversationId: sourceConversation.id },
        select: {
          userId: true,
          lastReadAt: true,
          lastReadMessageId: true,
          lastReadMessage: {
            select: { id: true, externalTimestamp: true },
          },
        },
      }),
      client.conversationRead.findMany({
        where: { conversationId: targetConversation.id },
        select: {
          userId: true,
          lastReadAt: true,
          lastReadMessageId: true,
          lastReadMessage: {
            select: { id: true, externalTimestamp: true },
          },
        },
      }),
      client.message.findMany({
        where: {
          id: {
            in: [
              targetConversation.teamLastReadMessageId,
              sourceConversation.teamLastReadMessageId,
            ].filter((id): id is string => id !== null),
          },
        },
        select: { id: true, externalTimestamp: true },
      }),
    ]);
    const targetReadsByUser = new Map(
      targetReads.map((read) => [read.userId, read]),
    );

    await client.message.updateMany({
      where: { conversationId: sourceConversation.id },
      data: { conversationId: targetConversation.id },
    });

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
  }

  async function resolveEchoContact(input: {
    phone: string | null;
    whatsappUserId: string | null;
  }): Promise<{ id: string }> {
    const identities: Prisma.ContactWhereInput[] = [];
    if (input.phone) {
      identities.push({ phone: input.phone }, { whatsappId: input.phone });
    }
    if (input.whatsappUserId) {
      identities.push({ whatsappUserId: input.whatsappUserId });
    }

    const select = {
      id: true,
      whatsappId: true,
      whatsappUserId: true,
      phone: true,
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
    const phoneContact = input.phone
      ? contacts.find(
          (contact) =>
            contact.phone === input.phone || contact.whatsappId === input.phone,
        )
      : undefined;
    const bsuidContact = input.whatsappUserId
      ? contacts.find(
          (contact) => contact.whatsappUserId === input.whatsappUserId,
        )
      : undefined;

    if (!phoneContact && !bsuidContact) {
      return client.contact.create({
        data: {
          whatsappId: input.phone,
          whatsappUserId: input.whatsappUserId,
          phone: input.phone,
          name: input.phone ?? "WhatsApp",
        },
        select: { id: true },
      });
    }

    const target = phoneContact ?? bsuidContact!;
    const source =
      phoneContact && bsuidContact && phoneContact.id !== bsuidContact.id
        ? bsuidContact
        : null;

    for (const contact of source ? [target, source] : [target]) {
      if (
        input.phone &&
        contact.phone &&
        contact.phone !== input.phone &&
        contact.whatsappId !== input.phone
      ) {
        throw new Error("Conflicting echo contact identities");
      }
      if (
        input.whatsappUserId &&
        contact.whatsappUserId &&
        contact.whatsappUserId !== input.whatsappUserId
      ) {
        throw new Error("Conflicting echo contact identities");
      }
    }

    if (source) {
      if (target.conversation && source.conversation) {
        await mergeConversations(target.conversation, source.conversation);
      } else if (source.conversation) {
        await client.conversation.update({
          where: { id: source.conversation.id },
          data: { contactId: target.id },
        });
      }
      await client.contact.delete({ where: { id: source.id } });
    }

    return client.contact.update({
      where: { id: target.id },
      data: {
        whatsappId: target.whatsappId ?? input.phone,
        phone: target.phone ?? input.phone,
        whatsappUserId: target.whatsappUserId ?? input.whatsappUserId,
      },
      select: { id: true },
    });
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
    upsertContact({ whatsappId, phone, name }) {
      return client.contact.upsert({
        where: { whatsappId },
        create: { whatsappId, phone, name: name ?? phone },
        update: name ? { name } : {},
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
    createMessage(input) {
      return client.message.create({
        data: {
          conversationId: input.conversationId,
          whatsappMessageId: input.whatsappMessageId,
          type: input.type,
          body: input.body,
          mediaObjectId: input.mediaObjectId,
          sentByUserId: input.sentByUserId,
          status: input.status,
          direction: input.direction,
          externalTimestamp: input.externalTimestamp,
        },
        select: { id: true, conversationId: true },
      });
    },
    refreshResponseState(conversationId) {
      return refreshResponseState(client, conversationId);
    },
    updateMessageStatus(messageId, status, failureReason) {
      return client.message.update({
        where: { id: messageId },
        data: { status, failureReason },
        select: { id: true, conversationId: true, status: true },
      });
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
  publishRealtime,
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
    case "messageEchoControl":
      return `message-echo-control:${event.action}:${event.whatsappMessageId}:${event.originalWhatsappMessageId}`;
  }
}

function safeErrorSummary(error: unknown): string {
  const name =
    error !== null && typeof error === "object" && "name" in error
      ? String(error.name).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64)
      : "Unknown";
  return `processing_error:${name || "Unknown"}`;
}

function shouldApplyStatus(
  current: MessageStatusValue,
  next: NormalizedStatusEvent["status"],
): boolean {
  if (current === MessageStatus.RECEIVED || current === MessageStatus.READ) {
    return false;
  }

  if (next === MessageStatus.FAILED) {
    return current === MessageStatus.PENDING || current === MessageStatus.SENT;
  }

  if (current === MessageStatus.FAILED) {
    return false;
  }

  const rank: Partial<Record<MessageStatusValue, number>> = {
    [MessageStatus.PENDING]: 0,
    [MessageStatus.SENT]: 1,
    [MessageStatus.DELIVERED]: 2,
    [MessageStatus.READ]: 3,
  };

  return (rank[next] ?? -1) > (rank[current] ?? -1);
}

async function processMessage(
  event: NormalizedMessageEvent,
  key: string,
  repository: WebhookRepository,
): Promise<{ duplicate: boolean; realtime: RealtimeEvent | null; pendingMediaId: string | null }> {
  const existing = await repository.findMessage(event.whatsappMessageId);

  if (existing) {
    await repository.completeEvent(key);
    return { duplicate: true, realtime: null, pendingMediaId: null };
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
    mediaObjectId: media?.id ?? null,
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
    realtime: {
      type: "message.created",
      conversationId: message.conversationId,
      messageId: message.id,
    },
  };
}

async function processMessageEcho(
  event: NormalizedMessageEchoEvent,
  key: string,
  repository: WebhookRepository,
): Promise<{
  duplicate: boolean;
  realtime: RealtimeEvent | null;
  pendingMediaId: string | null;
}> {
  const existing = await repository.findMessage(event.whatsappMessageId);

  if (existing) {
    await repository.completeEvent(key);
    return { duplicate: true, realtime: null, pendingMediaId: null };
  }

  const contact = await repository.resolveEchoContact({
    phone: event.to,
    whatsappUserId: event.toUserId,
  });
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
    mediaObjectId: media?.id ?? null,
    direction: MessageDirection.OUTBOUND,
    status: MessageStatus.SENT,
    sentByUserId: null,
    externalTimestamp: event.timestamp,
  });
  await repository.refreshResponseState(conversation.id);
  await repository.completeEvent(key);

  return {
    duplicate: false,
    pendingMediaId: media?.id ?? null,
    realtime: {
      type: "message.created",
      conversationId: message.conversationId,
      messageId: message.id,
    },
  };
}

async function processMessageEchoControl(
  _event: NormalizedMessageEchoControlEvent,
  key: string,
  repository: WebhookRepository,
): Promise<{
  duplicate: boolean;
  realtime: RealtimeEvent | null;
  pendingMediaId: string | null;
}> {
  await repository.completeEvent(key);
  return { duplicate: false, realtime: null, pendingMediaId: null };
}

async function processStatus(
  event: NormalizedStatusEvent,
  key: string,
  repository: WebhookRepository,
  now: Date,
): Promise<{ duplicate: boolean; realtime: RealtimeEvent | null; pendingMediaId: string | null }> {
  const message = await repository.findMessage(event.whatsappMessageId);

  if (!message) {
    if (Math.abs(now.getTime() - event.timestamp.getTime()) <= MISSING_STATUS_RETRY_GRACE_MS) {
      throw new WebhookProcessingError(true);
    }
    await repository.completeEvent(key);
    return { duplicate: false, realtime: null, pendingMediaId: null };
  }

  let realtime: RealtimeEvent | null = null;

  if (shouldApplyStatus(message.status, event.status)) {
    const updated = await repository.updateMessageStatus(
      message.id,
      event.status,
      event.failureReason,
    );
    realtime = {
      type: "message.status",
      conversationId: updated.conversationId,
      messageId: updated.id,
    };
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
    const key = deduplicationKey(event);
    const now = dependencies.now?.() ?? new Date();
    let outcome: {
      duplicate: boolean;
      realtime: RealtimeEvent | null;
      pendingMediaId: string | null;
    };

    try {
      outcome = await dependencies.transaction(async (repository) => {
        const reservation = await repository.reserveEvent(key, event.kind);

        if (reservation === WebhookStatus.PROCESSED) {
          return { duplicate: true, realtime: null, pendingMediaId: null };
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
          case "messageEchoControl":
            return processMessageEchoControl(event, key, repository);
        }
      });
    } catch (error) {
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
      continue;
    }

    summary.processed += 1;

    if (outcome.pendingMediaId && onMediaCommitted) {
      try {
        onMediaCommitted(outcome.pendingMediaId);
      } catch {
        // The committed media record remains available for on-demand recovery.
      }
    }

    if (outcome.realtime) {
      try {
        dependencies.publishRealtime(outcome.realtime);
      } catch {
        // Database state is authoritative; clients resynchronize after reconnecting.
      }
    }
  }

  return summary;
}
