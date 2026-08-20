import "server-only";

import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import {
  MediaStatus,
  MessageDirection,
  MessageStatus,
  WebhookStatus,
  type MessageStatus as MessageStatusValue,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { publishRealtime } from "@/modules/realtime/hub";
import type { RealtimeEvent } from "@/modules/realtime/events";

import type {
  NormalizedMedia,
  NormalizedMessageEvent,
  NormalizedStatusEvent,
  NormalizedWebhookEvent,
  ProcessSummary,
} from "./types";

type ReservationResult = "NEW" | "RECLAIMED" | WebhookStatus;

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
  upsertConversation(contactId: string, timestamp: Date): Promise<{ id: string }>;
  findMessage(whatsappMessageId: string): Promise<MessageRecord | null>;
  createMedia(media: NormalizedMedia): Promise<{ id: string }>;
  createMessage(input: {
    conversationId: string;
    whatsappMessageId: string;
    type: NormalizedMessageEvent["type"];
    body: string | null;
    mediaObjectId: string | null;
    externalTimestamp: Date;
  }): Promise<{ id: string; conversationId: string }>;
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
};

type PrismaWebhookClient = Pick<
  PrismaClient,
  "webhookEvent" | "contact" | "conversation" | "message" | "mediaObject"
>;

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
          direction: MessageDirection.INBOUND,
          type: input.type,
          body: input.body,
          mediaObjectId: input.mediaObjectId,
          sentByUserId: null,
          status: MessageStatus.RECEIVED,
          externalTimestamp: input.externalTimestamp,
        },
        select: { id: true, conversationId: true },
      });
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

function deduplicationKey(event: NormalizedWebhookEvent): string {
  return event.kind === "message"
    ? `message:${event.whatsappMessageId}`
    : `status:${event.whatsappMessageId}:${event.status}:${event.timestampRaw}`;
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
    externalTimestamp: event.timestamp,
  });
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

async function processStatus(
  event: NormalizedStatusEvent,
  key: string,
  repository: WebhookRepository,
): Promise<{ duplicate: boolean; realtime: RealtimeEvent | null; pendingMediaId: string | null }> {
  const message = await repository.findMessage(event.whatsappMessageId);

  if (!message) {
    throw new WebhookProcessingError(true);
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

        return event.kind === "message"
          ? processMessage(event, key, repository)
          : processStatus(event, key, repository);
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
