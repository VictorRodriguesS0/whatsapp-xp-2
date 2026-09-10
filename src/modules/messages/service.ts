import "server-only";

import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";

import { Prisma } from "@/generated/prisma/client";
import {
  MediaStatus,
  MessageDirection,
  MessageOperationalState,
  MessageStatus,
  MessageType,
  OutboundPayloadKind,
  type MessageType as MessageTypeValue,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/http";
import type { SessionUser } from "@/modules/auth/session";
import { runConversationTransaction } from "@/modules/conversations/service";
import { refreshResponseState } from "@/modules/conversations/shared-state";
import { assertConnectionSendAllowed } from "@/modules/meta-health/send-guard";
import { assertFreeFormSendAllowed } from "@/modules/messaging-policy/service";
import type {
  MessageDto,
  QuotedReplyRecord,
} from "@/modules/conversations/types";
import { LocalMediaStorage } from "@/modules/media/local-storage";
import type { MediaStorage } from "@/modules/media/storage";
import { validateMedia, validateMediaFile } from "@/modules/media/validation";
import type { RealtimeEvent } from "@/modules/realtime/events";
import { publishRealtime } from "@/modules/realtime/hub";
import { getServerEnv } from "@/lib/env";
import { getCatalogService } from "@/modules/catalog/factory";
import {
  CATALOG_MESSAGE_FOOTER,
  CATALOG_PRODUCT_MESSAGE_BODY,
  toCatalogProductSnapshot,
  type CatalogOutboundContent,
} from "@/modules/catalog/message-content";
import type { CatalogProduct } from "@/modules/catalog/schemas";
import { getWhatsAppProvider } from "@/modules/whatsapp/factory";
import { WhatsAppProviderError } from "@/modules/whatsapp/meta-provider";
import type { MediaMessageType, WhatsAppProvider } from "@/modules/whatsapp/provider";
import {
  quotedReplyPreview,
  whatsappMessageIdSchema,
} from "@/modules/messages/reply-context";

import {
  clientRequestIdSchema,
  messageUuidSchema,
  outboundMediaFieldsSchema,
  outboundTextSchema,
} from "./schemas";
import {
  reconcileReplyLinks,
  resolveReplyTarget,
} from "./reply-linking.server";
import { parseMessageContent, type MessageContent } from "./content";
import { messageContentForPrisma } from "./content.server";
import { shouldApplyMessageStatus } from "./status-precedence";
import { safeFailureReason, safeOriginalFilename } from "./status";

export const MESSAGE_SEND_RATE_LIMIT = 30;
export const MESSAGE_SEND_RATE_WINDOW_MS = 60_000;
const DELIVERY_LEASE_MS = 30_000;

export type MessageFileInput = {
  filename: string;
  mimeType: string;
} & (
  | { bytes: Uint8Array; path?: never; sizeBytes?: never; sha256?: never; cleanup?: never }
  | { path: string; sizeBytes: bigint; sha256: string; cleanup(): Promise<void>; bytes?: never }
);

export type SendMessageInput =
  | {
      type: "TEXT";
      clientRequestId: string;
      body: string;
      replyToMessageId?: string;
    }
  | {
      type: "IMAGE" | "AUDIO" | "VIDEO" | "DOCUMENT";
      clientRequestId: string;
      body?: string;
      replyToMessageId?: string;
      file: MessageFileInput;
    };

export type MessageMediaRecord = {
  id: string;
  storageKey: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: bigint;
  sha256: string;
  metaMediaId: string | null;
};

export type MessageServiceRecord = {
  id: string;
  conversationId: string;
  whatsappMessageId: string | null;
  replyToMessageId: string | null;
  replyToWhatsappMessageId: string | null;
  replyToMessage: QuotedReplyRecord | null;
  clientRequestId: string;
  direction: MessageDirection;
  type: MessageTypeValue;
  body: string | null;
  content: MessageContent | null;
  mediaObjectId: string | null;
  sentByUserId: string;
  sentByUser: { id: string; name: string };
  status: MessageStatus;
  failureReason: string | null;
  outboundPayloadKind: OutboundPayloadKind;
  templateName: string | null;
  templateLanguage: string | null;
  templateComponents: unknown;
  templateDefinitionHash: string | null;
  operationalState: MessageOperationalState;
  providerAttemptedAt: Date | null;
  deliveryLeaseId: string | null;
  deliveryLeaseUntil: Date | null;
  externalTimestamp: Date;
  createdAt: Date;
  contactPhone: string;
  mediaObject: MessageMediaRecord | null;
};

export type PreparedTemplatePayload = {
  kind: "TEMPLATE";
  name: string;
  language: "pt_BR";
  definitionHash: string;
  bodyParameters: [{ type: "text"; text: string }];
};

export type PendingMessageInput = {
  conversationId: string;
  clientRequestId: string;
  sentByUserId: string;
  type: MessageTypeValue;
  body: string | null;
  content?: MessageContent | null;
  replyToMessageId: string | null;
  externalTimestamp: Date;
  payload?: PreparedTemplatePayload;
};

export type PreparedTemplateMessageInput = {
  clientRequestId: string;
  body: string;
  payload: PreparedTemplatePayload;
};

export type PreparedCatalogMessageInput = {
  clientRequestId: string;
  body: string;
  content: CatalogOutboundContent;
};

export type StoredMessageMediaInput = {
  storageKey: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: bigint;
  sha256: string;
};

export type AttachmentCommitResult = "ATTACHED" | "CAS_LOST" | "NO_COMMIT" | "COMMIT_UNKNOWN";
export type ProviderAttemptCommitResult = "MARKED" | "CAS_LOST";

export interface MessageServiceRepository {
  findByClientRequestId(clientRequestId: string): Promise<MessageServiceRecord | null>;
  createPending(input: PendingMessageInput): Promise<{ message: MessageServiceRecord; created: boolean }>;
  updateContent(messageId: string, content: MessageContent): Promise<MessageServiceRecord>;
  attachStoredMedia(messageId: string, input: StoredMessageMediaInput): Promise<AttachmentCommitResult>;
  setMediaMetaId(messageId: string, metaMediaId: string): Promise<MessageServiceRecord>;
  markOperation(messageId: string, operationalState: MessageOperationalState, attemptedAt?: Date | null): Promise<MessageServiceRecord>;
  claimReadyForDelivery(messageId: string, input: { leaseId: string; now: Date; leaseUntil: Date }): Promise<MessageServiceRecord | null>;
  releaseDeliveryClaim(messageId: string, leaseId: string): Promise<void>;
  markProviderAttempt(messageId: string, leaseId: string, operationalState: MessageOperationalState, attemptedAt: Date): Promise<ProviderAttemptCommitResult>;
  markSent(messageId: string, whatsappMessageId: string): Promise<MessageServiceRecord>;
  markFailed(messageId: string, failureReason: string, operationalState: MessageOperationalState): Promise<MessageServiceRecord>;
  findById(messageId: string): Promise<MessageServiceRecord | null>;
  claimFailedForRetry(messageId: string): Promise<MessageServiceRecord | null>;
}

declare const rateLimitReservationBrand: unique symbol;

export type MessageRateLimitReservation = {
  readonly id: string;
  readonly userId: string;
  readonly [rateLimitReservationBrand]: true;
};

export class MessageSendRateLimiter {
  private readonly attempts = new Map<string, Array<{ id: string; time: number }>>();

  consume(userId: string, now = new Date()): MessageRateLimitReservation | null {
    const boundary = now.getTime() - MESSAGE_SEND_RATE_WINDOW_MS;
    const active = (this.attempts.get(userId) ?? []).filter(({ time }) => time > boundary);
    if (active.length >= MESSAGE_SEND_RATE_LIMIT) {
      this.attempts.set(userId, active);
      return null;
    }
    const reservation = { id: randomUUID(), userId } as MessageRateLimitReservation;
    active.push({ id: reservation.id, time: now.getTime() });
    this.attempts.set(userId, active);
    return reservation;
  }

  refund(reservation: MessageRateLimitReservation): void {
    const attempts = this.attempts.get(reservation.userId);
    if (!attempts) return;
    const remaining = attempts.filter(({ id }) => id !== reservation.id);
    if (remaining.length === 0) this.attempts.delete(reservation.userId);
    else this.attempts.set(reservation.userId, remaining);
  }
}

export class ProviderConcurrencyLimiter {
  private readonly active = new Map<string, number>();
  private readonly queues = new Map<string, Array<() => void>>();
  constructor(private readonly maximumPerUser = 2) {}

  async run<T>(userId: string, work: () => Promise<T>): Promise<T> {
    if ((this.active.get(userId) ?? 0) >= this.maximumPerUser) {
      await new Promise<void>((resolve) => {
        const queue = this.queues.get(userId) ?? [];
        queue.push(resolve);
        this.queues.set(userId, queue);
      });
    } else {
      this.active.set(userId, (this.active.get(userId) ?? 0) + 1);
    }
    try {
      return await work();
    } finally {
      const next = this.queues.get(userId)?.shift();
      if (this.queues.get(userId)?.length === 0) this.queues.delete(userId);
      if (next) next();
      else {
        const remaining = (this.active.get(userId) ?? 1) - 1;
        if (remaining === 0) this.active.delete(userId); else this.active.set(userId, remaining);
      }
    }
  }
}

export type MessageServiceDependencies = {
  repository: MessageServiceRepository;
  storage: MediaStorage;
  provider: WhatsAppProvider;
  limiter: MessageSendRateLimiter;
  concurrency?: ProviderConcurrencyLimiter;
  idempotencyInFlight?: Map<string, Promise<MessageDto>>;
  publishRealtime(event: RealtimeEvent): void;
  now?: () => Date;
  createUuid?: () => string;
  deliveryLeaseMs?: number;
  assertConnectionSendAllowed?(): Promise<void>;
  assertFreeFormSendAllowed?(
    conversationId: string,
    now: Date,
  ): Promise<void>;
  revalidateCatalogForSend?(
    retailerIds: readonly string[],
  ): Promise<CatalogProduct[]>;
};

function connectionGuard(dependencies: MessageServiceDependencies) {
  return dependencies.assertConnectionSendAllowed ?? assertConnectionSendAllowed;
}

function freeFormGuard(dependencies: MessageServiceDependencies) {
  return dependencies.assertFreeFormSendAllowed ?? assertFreeFormSendAllowed;
}

const replyPreviewSelect = {
  id: true,
  direction: true,
  type: true,
  body: true,
  content: true,
  sentByUser: { select: { id: true, name: true } },
  mediaObject: { select: { originalFilename: true } },
  revokedAt: true,
} as const;

const prismaMessageScalarSelect = {
  id: true,
  conversationId: true,
  whatsappMessageId: true,
  replyToMessageId: true,
  replyToWhatsappMessageId: true,
  replyToMessage: { select: replyPreviewSelect },
  clientRequestId: true,
  direction: true,
  type: true,
  body: true,
  content: true,
  mediaObjectId: true,
  sentByUserId: true,
  status: true,
  failureReason: true,
  outboundPayloadKind: true,
  templateName: true,
  templateLanguage: true,
  templateComponents: true,
  templateDefinitionHash: true,
  operationalState: true,
  providerAttemptedAt: true,
  deliveryLeaseId: true,
  deliveryLeaseUntil: true,
  externalTimestamp: true,
  createdAt: true,
} as const;

type PrismaMessageRow = Prisma.MessageGetPayload<{ select: typeof prismaMessageScalarSelect }>;

async function hydrateServiceRecord(row: PrismaMessageRow): Promise<MessageServiceRecord> {
  if (!row.clientRequestId || !row.sentByUserId) {
    throw new Error("Invalid outbound message record");
  }
  const sentByUser = await prisma.user.findUnique({
    where: { id: row.sentByUserId },
    select: { id: true, name: true },
  });
  const conversation = await prisma.conversation.findUnique({
    where: { id: row.conversationId },
    select: { contactId: true },
  });
  if (!sentByUser || !conversation) throw new Error("Invalid outbound message relations");
  const contact = await prisma.contact.findUnique({
    where: { id: conversation.contactId },
    select: { phone: true },
  });
  const media = row.mediaObjectId
    ? await prisma.mediaObject.findUnique({
        where: { id: row.mediaObjectId },
        select: {
          id: true,
          storageKey: true,
          originalFilename: true,
          mimeType: true,
          sizeBytes: true,
          sha256: true,
          metaMediaId: true,
        },
      })
    : null;
  if (!contact?.phone) throw new Error("Invalid outbound conversation contact");
  return {
    id: row.id,
    conversationId: row.conversationId,
    whatsappMessageId: row.whatsappMessageId,
    replyToMessageId: row.replyToMessageId,
    replyToWhatsappMessageId: row.replyToWhatsappMessageId,
    replyToMessage: row.replyToMessage,
    clientRequestId: row.clientRequestId,
    direction: row.direction,
    type: row.type,
    body: row.body,
    content: parseMessageContent(row.content),
    mediaObjectId: row.mediaObjectId,
    sentByUserId: row.sentByUserId,
    sentByUser,
    status: row.status,
    failureReason: row.failureReason,
    outboundPayloadKind: row.outboundPayloadKind,
    templateName: row.templateName,
    templateLanguage: row.templateLanguage,
    templateComponents: row.templateComponents,
    templateDefinitionHash: row.templateDefinitionHash,
    operationalState: row.operationalState,
    providerAttemptedAt: row.providerAttemptedAt,
    deliveryLeaseId: row.deliveryLeaseId,
    deliveryLeaseUntil: row.deliveryLeaseUntil,
    externalTimestamp: row.externalTimestamp,
    createdAt: row.createdAt,
    contactPhone: contact.phone,
    mediaObject:
      media?.storageKey && media.sha256
        ? { ...media, storageKey: media.storageKey, sha256: media.sha256 }
        : null,
  };
}

function isRawDatabaseCode(error: unknown, databaseCode: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2010" &&
    JSON.stringify(error.meta).includes(databaseCode)
  );
}

function isPrismaUnique(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2002" || isRawDatabaseCode(error, "23505"))
  );
}

type AttachmentMutationContext = {
  transaction: Prisma.TransactionClient;
  messageId: string;
  input: StoredMessageMediaInput;
};

type AttachmentMutationResult = Exclude<AttachmentCommitResult, "NO_COMMIT" | "COMMIT_UNKNOWN">;
type AttachmentMutation = (
  context: AttachmentMutationContext,
  mutate: (context: AttachmentMutationContext) => Promise<AttachmentMutationResult>,
) => Promise<AttachmentMutationResult>;
type AttachmentTransactionRunner = <T>(
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
) => Promise<T>;

export type PrismaMessageRepositoryOptions = {
  attachmentMutation?: AttachmentMutation;
  runAttachmentTransaction?: AttachmentTransactionRunner;
};

const ATTACHMENT_TRANSACTION_MAX_ATTEMPTS = 3;

function prismaErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

async function mutateStoredMediaAttachment(context: AttachmentMutationContext): Promise<AttachmentMutationResult> {
  const media = await context.transaction.mediaObject.create({
    data: {
      storageProvider: "local",
      storageKey: context.input.storageKey,
      originalFilename: context.input.originalFilename,
      mimeType: context.input.mimeType,
      sizeBytes: context.input.sizeBytes,
      sha256: context.input.sha256,
      status: MediaStatus.AVAILABLE,
    },
    select: { id: true },
  });
  const claimed = await context.transaction.message.updateMany({
    where: {
      id: context.messageId,
      direction: MessageDirection.OUTBOUND,
      mediaObjectId: null,
      OR: [
        { status: MessageStatus.PENDING, operationalState: MessageOperationalState.READY },
        { status: MessageStatus.FAILED, operationalState: MessageOperationalState.LOCAL_FAILURE },
      ],
    },
    data: {
      mediaObjectId: media.id,
      status: MessageStatus.PENDING,
      failureReason: null,
      operationalState: MessageOperationalState.READY,
      deliveryLeaseId: null,
      deliveryLeaseUntil: null,
    },
  });
  if (claimed.count !== 1) {
    await context.transaction.mediaObject.delete({ where: { id: media.id } });
    return "CAS_LOST";
  }
  return "ATTACHED";
}

async function attachStoredMediaWithOutcome(
  messageId: string,
  input: StoredMessageMediaInput,
  options: PrismaMessageRepositoryOptions,
): Promise<AttachmentCommitResult> {
  const runTransaction = options.runAttachmentTransaction ?? ((operation) => prisma.$transaction(operation));
  const mutation = options.attachmentMutation ?? ((context, mutate) => mutate(context));
  for (let attempt = 1; attempt <= ATTACHMENT_TRANSACTION_MAX_ATTEMPTS; attempt += 1) {
    let callbackCompleted = false;
    let callbackResult: AttachmentMutationResult | undefined;
    try {
      return await runTransaction(async (transaction) => {
        const result = await mutation({ transaction, messageId, input }, mutateStoredMediaAttachment);
        callbackResult = result;
        callbackCompleted = true;
        return result;
      });
    } catch (error) {
      if (callbackResult === "CAS_LOST") return "CAS_LOST";
      if (prismaErrorCode(error) === "P2034") {
        if (attempt < ATTACHMENT_TRANSACTION_MAX_ATTEMPTS) continue;
        return "NO_COMMIT";
      }
      return callbackCompleted && callbackResult === "ATTACHED" ? "COMMIT_UNKNOWN" : "NO_COMMIT";
    }
  }
  return "NO_COMMIT";
}

export const prismaMessageRepository: MessageServiceRepository = {
  async findByClientRequestId(clientRequestId) {
    const row = await prisma.message.findUnique({
      where: { clientRequestId },
      select: prismaMessageScalarSelect,
    });
    return row ? hydrateServiceRecord(row) : null;
  },
  async createPending(input) {
    const messageId = randomUUID();
    try {
      await runConversationTransaction(prisma, async (transaction) => {
        const conversation = await transaction.conversation.findUnique({
          where: { id: input.conversationId },
          select: { contact: { select: { phone: true } } },
        });
        if (!conversation) {
          throw new HttpError(404, "Conversa não encontrada");
        }
        if (!conversation.contact.phone) {
          throw new HttpError(409, "Contato sem telefone disponível");
        }
        const replyTarget = input.replyToMessageId
          ? await resolveReplyTarget(
              transaction,
              input.conversationId,
              input.replyToMessageId,
            )
          : null;
        if (input.replyToMessageId && !replyTarget) {
          throw new HttpError(
            409,
            "Mensagem original indisponível para resposta",
          );
        }

        await transaction.message.create({
          data: {
            id: messageId,
            conversationId: input.conversationId,
            clientRequestId: input.clientRequestId,
            direction: MessageDirection.OUTBOUND,
            type: input.type,
            body: input.body,
            content: messageContentForPrisma(input.content ?? null),
            replyToMessageId: replyTarget?.id ?? null,
            replyToWhatsappMessageId: replyTarget?.whatsappMessageId ?? null,
            sentByUserId: input.sentByUserId,
            status: MessageStatus.PENDING,
            ...(input.payload
              ? {
                  outboundPayloadKind: OutboundPayloadKind.TEMPLATE,
                  templateName: input.payload.name,
                  templateLanguage: input.payload.language,
                  templateComponents: [
                    {
                      type: "body",
                      parameters: input.payload.bodyParameters,
                    },
                  ],
                  templateDefinitionHash: input.payload.definitionHash,
                }
              : {}),
            externalTimestamp: input.externalTimestamp,
          },
        });
        await transaction.conversation.updateMany({
          where: {
            id: input.conversationId,
            lastMessageAt: { lt: input.externalTimestamp },
          },
          data: { lastMessageAt: input.externalTimestamp },
        });
        await refreshResponseState(transaction, input.conversationId);
      });
      const row = await prisma.message.findUniqueOrThrow({
        where: { id: messageId },
        select: prismaMessageScalarSelect,
      });
      return { message: await hydrateServiceRecord(row), created: true };
    } catch (error) {
      if (isRawDatabaseCode(error, "23503")) {
        throw new HttpError(404, "Conversa não encontrada");
      }
      if (!isPrismaUnique(error)) throw error;
      const existing = await this.findByClientRequestId(input.clientRequestId);
      if (!existing) throw error;
      return { message: existing, created: false };
    }
  },
  async attachStoredMedia(messageId, input) {
    return attachStoredMediaWithOutcome(messageId, input, {});
  },
  async updateContent(messageId, content) {
    const row = await prisma.message.update({
      where: { id: messageId },
      data: { content: messageContentForPrisma(content) },
      select: prismaMessageScalarSelect,
    });
    return hydrateServiceRecord(row);
  },
  async setMediaMetaId(messageId, metaMediaId) {
    const current = await prisma.message.findUniqueOrThrow({ where: { id: messageId }, select: { mediaObjectId: true } });
    if (!current.mediaObjectId) throw new Error("Missing media");
    await prisma.mediaObject.update({ where: { id: current.mediaObjectId }, data: { metaMediaId } });
    return this.findById(messageId).then((message) => message!);
  },
  async markOperation(messageId, operationalState, attemptedAt = null) {
    const row = await prisma.message.update({
      where: { id: messageId },
      data: {
        operationalState,
        ...(attemptedAt ? { providerAttemptedAt: attemptedAt } : {}),
      },
      select: prismaMessageScalarSelect,
    });
    return hydrateServiceRecord(row);
  },
  async claimReadyForDelivery(messageId, input) {
    const claimed = await prisma.message.updateMany({
      where: {
        id: messageId,
        direction: MessageDirection.OUTBOUND,
        status: MessageStatus.PENDING,
        operationalState: MessageOperationalState.READY,
        OR: [{ deliveryLeaseUntil: null }, { deliveryLeaseUntil: { lte: input.now } }],
      },
      data: { deliveryLeaseId: input.leaseId, deliveryLeaseUntil: input.leaseUntil },
    });
    return claimed.count === 1 ? this.findById(messageId) : null;
  },
  async releaseDeliveryClaim(messageId, leaseId) {
    await prisma.message.updateMany({
      where: {
        id: messageId,
        status: MessageStatus.PENDING,
        operationalState: MessageOperationalState.READY,
        deliveryLeaseId: leaseId,
      },
      data: { deliveryLeaseId: null, deliveryLeaseUntil: null },
    });
  },
  async markProviderAttempt(messageId, leaseId, operationalState, attemptedAt) {
    const marked = await prisma.message.updateMany({
      where: {
        id: messageId,
        status: MessageStatus.PENDING,
        operationalState: MessageOperationalState.READY,
        deliveryLeaseId: leaseId,
      },
      data: {
        operationalState,
        providerAttemptedAt: attemptedAt,
        deliveryLeaseId: null,
        deliveryLeaseUntil: null,
      },
    });
    return marked.count === 1 ? "MARKED" : "CAS_LOST";
  },
  async markSent(messageId, whatsappMessageId) {
    const parsedWhatsappMessageId = whatsappMessageIdSchema.parse(
      whatsappMessageId,
    );
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await runConversationTransaction(prisma, async (transaction) => {
          const outbound = await transaction.message.findUniqueOrThrow({
            where: { id: messageId },
            select: {
              id: true,
              conversationId: true,
              direction: true,
              clientRequestId: true,
              sentByUserId: true,
            },
          });
          const echo = await transaction.message.findUnique({
            where: { whatsappMessageId: parsedWhatsappMessageId },
            select: {
              id: true,
              conversationId: true,
              direction: true,
              clientRequestId: true,
              sentByUserId: true,
              mediaObjectId: true,
              status: true,
              failureReason: true,
              mediaObject: { select: { storageKey: true } },
            },
          });

          const finalStatus = echo && !shouldApplyMessageStatus(
            echo.status,
            MessageStatus.SENT,
          )
            ? echo.status
            : MessageStatus.SENT;
          const finalFailureReason = finalStatus === MessageStatus.FAILED
            ? echo?.failureReason ?? null
            : null;

          if (echo && echo.id !== outbound.id) {
            const isMatchingEcho = (
              outbound.direction === MessageDirection.OUTBOUND
              && outbound.clientRequestId !== null
              && outbound.sentByUserId !== null
              && echo.conversationId === outbound.conversationId
              && echo.direction === MessageDirection.OUTBOUND
              && echo.clientRequestId === null
              && echo.sentByUserId === null
            );
            if (!isMatchingEcho) {
              throw new Error("Provider message id already belongs to another message");
            }

            await transaction.conversationRead.updateMany({
              where: { lastReadMessageId: echo.id },
              data: { lastReadMessageId: outbound.id },
            });
            await transaction.conversation.updateMany({
              where: { teamLastReadMessageId: echo.id },
              data: { teamLastReadMessageId: outbound.id },
            });
            await transaction.message.updateMany({
              where: { replyToMessageId: echo.id },
              data: { replyToMessageId: outbound.id },
            });
            await transaction.conversationAuditEvent.updateMany({
              where: { messageId: echo.id },
              data: { messageId: outbound.id },
            });
            await transaction.message.delete({ where: { id: echo.id } });
            if (echo.mediaObjectId && echo.mediaObject?.storageKey === null) {
              await transaction.mediaObject.deleteMany({
                where: { id: echo.mediaObjectId, message: null },
              });
            }
          }

          const updated = await transaction.message.update({
            where: { id: messageId },
            data: {
              whatsappMessageId: parsedWhatsappMessageId,
              status: finalStatus,
              failureReason: finalFailureReason,
              operationalState: MessageOperationalState.SENT,
              deliveryLeaseId: null,
              deliveryLeaseUntil: null,
            },
            select: { id: true, conversationId: true },
          });
          await reconcileReplyLinks(transaction, {
            conversationId: updated.conversationId,
            messageId: updated.id,
            whatsappMessageId: parsedWhatsappMessageId,
          });
          await refreshResponseState(transaction, updated.conversationId);
        });
        break;
      } catch (error) {
        if (attempt === 0 && isPrismaUnique(error)) continue;
        throw error;
      }
    }
    const hydrated = await this.findById(messageId);
    if (!hydrated) throw new Error("Committed outbound message could not be hydrated");
    return hydrated;
  },
  async markFailed(messageId, failureReason, operationalState) {
    await runConversationTransaction(prisma, async (transaction) => {
      const failed = await transaction.message.update({
        where: { id: messageId },
        data: {
          status: MessageStatus.FAILED,
          failureReason,
          operationalState,
          deliveryLeaseId: null,
          deliveryLeaseUntil: null,
        },
        select: { conversationId: true },
      });
      await refreshResponseState(transaction, failed.conversationId);
    });
    const hydrated = await this.findById(messageId);
    if (!hydrated) throw new Error("Failed outbound message could not be hydrated");
    return hydrated;
  },
  async findById(messageId) {
    const row = await prisma.message.findUnique({ where: { id: messageId }, select: prismaMessageScalarSelect });
    return row ? hydrateServiceRecord(row) : null;
  },
  async claimFailedForRetry(messageId) {
    const claimedId = await prisma.$transaction(async (transaction) => {
      const claimed = await transaction.message.updateMany({
        where: {
          id: messageId,
          direction: MessageDirection.OUTBOUND,
          status: MessageStatus.FAILED,
          operationalState: { in: [MessageOperationalState.REJECTED, MessageOperationalState.LOCAL_FAILURE] },
        },
        data: { status: MessageStatus.PENDING, failureReason: null, operationalState: MessageOperationalState.READY, deliveryLeaseId: null, deliveryLeaseUntil: null },
      });
      if (claimed.count !== 1) return null;
      return messageId;
    });
    return claimedId ? this.findById(claimedId) : null;
  },
};

export function createPrismaMessageRepository(options: PrismaMessageRepositoryOptions): MessageServiceRepository {
  return {
    ...prismaMessageRepository,
    attachStoredMedia(messageId, input) {
      return attachStoredMediaWithOutcome(messageId, input, options);
    },
  };
}

const defaultLimiter = new MessageSendRateLimiter();
const defaultConcurrency = new ProviderConcurrencyLimiter();
const defaultIdempotencyInFlight = new Map<string, Promise<MessageDto>>();
const defaultDependencies: MessageServiceDependencies = {
  repository: prismaMessageRepository,
  storage: new LocalMediaStorage(getServerEnv().MEDIA_ROOT),
  provider: getWhatsAppProvider(),
  limiter: defaultLimiter,
  concurrency: defaultConcurrency,
  idempotencyInFlight: defaultIdempotencyInFlight,
  publishRealtime,
  assertFreeFormSendAllowed,
  revalidateCatalogForSend: (retailerIds) =>
    getCatalogService().revalidateForSend(retailerIds),
};

function toMessageDto(message: MessageServiceRecord): MessageDto {
  return {
    id: message.id,
    clientRequestId: message.clientRequestId,
    direction: message.direction,
    type: message.type,
    body: message.body,
    content: message.content,
    canReply: whatsappMessageIdSchema.safeParse(message.whatsappMessageId).success,
    replyTo: message.replyToMessage
      ? quotedReplyPreview({
          id: message.replyToMessage.id,
          direction: message.replyToMessage.direction,
          type: message.replyToMessage.type,
          body: message.replyToMessage.body,
          content: message.replyToMessage.content,
          sentBy: message.replyToMessage.sentByUser,
          revokedAt: message.replyToMessage.revokedAt,
        })
      : message.replyToWhatsappMessageId
        ? { available: false }
        : null,
    mediaObjectId: message.mediaObjectId,
    mediaState: message.mediaObject
      ? { status: MediaStatus.AVAILABLE, nextAttemptAt: null, canRetry: false }
      : null,
    sentBy: { id: message.sentByUser.id, name: message.sentByUser.name },
    status: message.status,
    failureReason: message.failureReason,
    editedAt: null,
    revokedAt: null,
    reactions: [],
    externalTimestamp: message.externalTimestamp.toISOString(),
    createdAt: message.createdAt.toISOString(),
  };
}

function publishSafely(dependencies: MessageServiceDependencies, event: RealtimeEvent): void {
  try {
    dependencies.publishRealtime(event);
  } catch {
    // The committed database state remains authoritative.
  }
}

function assertSameIdempotentOperation(
  message: MessageServiceRecord,
  actor: SessionUser,
  conversationId: string,
  replyToMessageId: string | undefined,
): void {
  if (
    message.conversationId !== conversationId ||
    message.sentByUserId !== actor.id ||
    message.replyToMessageId !== (replyToMessageId ?? null)
  ) {
    throw new HttpError(409, "Identificador de envio já utilizado");
  }
}

function providerMediaType(type: MessageTypeValue): MediaMessageType {
  const value = type.toLowerCase();
  if (value === "image" || value === "audio" || value === "video" || value === "document") return value;
  throw new Error("Unsupported media message type");
}

function catalogContent(message: MessageServiceRecord): CatalogOutboundContent | null {
  const content = message.content;
  return content?.kind === "catalog" ||
    content?.kind === "catalogProduct" ||
    content?.kind === "catalogProductList"
    ? content
    : null;
}

function catalogRetailerIds(content: CatalogOutboundContent): string[] {
  if (content.kind === "catalogProduct") return [content.product.retailerId];
  if (content.kind === "catalogProductList") {
    return content.products.map((product) => product.retailerId);
  }
  return content.thumbnailRetailerId ? [content.thumbnailRetailerId] : [];
}

async function refreshCatalogSnapshot(
  message: MessageServiceRecord,
  dependencies: MessageServiceDependencies,
): Promise<MessageServiceRecord> {
  const content = catalogContent(message);
  if (!content) return message;
  const products = await (
    dependencies.revalidateCatalogForSend ??
    ((ids: readonly string[]) => getCatalogService().revalidateForSend(ids))
  )(catalogRetailerIds(content));

  let refreshed: CatalogOutboundContent;
  if (content.kind === "catalogProduct") {
    const product = products[0];
    if (!product) throw new HttpError(409, "Produto indisponível", "CATALOG_PRODUCT_UNAVAILABLE");
    refreshed = { kind: "catalogProduct", product: toCatalogProductSnapshot(product) };
  } else if (content.kind === "catalogProductList") {
    if (products.length !== content.products.length) {
      throw new HttpError(409, "Produto indisponível", "CATALOG_PRODUCT_UNAVAILABLE");
    }
    refreshed = {
      kind: "catalogProductList",
      body: content.body,
      products: products.map(toCatalogProductSnapshot),
    };
  } else {
    if (content.thumbnailRetailerId && products.length !== 1) {
      throw new HttpError(409, "Produto indisponível", "CATALOG_PRODUCT_UNAVAILABLE");
    }
    refreshed = content;
  }
  return dependencies.repository.updateContent(message.id, refreshed);
}

class ProviderCallError extends Error {
  constructor(public readonly cause: unknown) {
    super("Provider call failed");
    this.name = "ProviderCallError";
  }
}

class ProviderCommitError extends Error {}

function preparedBodyParameters(
  message: MessageServiceRecord,
): [{ type: "text"; text: string }] {
  if (!Array.isArray(message.templateComponents) || message.templateComponents.length !== 1) {
    throw new Error("Invalid prepared template components");
  }
  const body = message.templateComponents[0];
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).sort().join(",") !== "parameters,type" ||
    !("type" in body) ||
    body.type !== "body" ||
    !("parameters" in body) ||
    !Array.isArray(body.parameters) ||
    body.parameters.length !== 1
  ) {
    throw new Error("Invalid prepared template components");
  }
  const parameter = body.parameters[0];
  if (
    !parameter ||
    typeof parameter !== "object" ||
    Array.isArray(parameter) ||
    Object.keys(parameter).sort().join(",") !== "text,type" ||
    !("type" in parameter) ||
    parameter.type !== "text" ||
    !("text" in parameter) ||
    typeof parameter.text !== "string" ||
    parameter.text.length < 1 ||
    parameter.text.length > 80
  ) {
    throw new Error("Invalid prepared template parameter");
  }
  return [{ type: "text", text: parameter.text }];
}

async function providerCall<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw new ProviderCallError(error);
  }
}

async function deliver(
  message: MessageServiceRecord,
  dependencies: MessageServiceDependencies,
): Promise<MessageServiceRecord> {
  if (message.outboundPayloadKind === OutboundPayloadKind.TEMPLATE) {
    if (
      !message.templateName ||
      message.templateLanguage !== "pt_BR" ||
      !message.templateDefinitionHash ||
      !/^[0-9a-f]{64}$/u.test(message.templateDefinitionHash)
    ) {
      throw new Error("Invalid prepared template message");
    }
    const bodyParameters = preparedBodyParameters(message);
    const result = await providerCall(() =>
      dependencies.provider.sendTemplate({
        to: message.contactPhone,
        name: message.templateName!,
        language: message.templateLanguage!,
        bodyParameters,
      }),
    );
    try {
      return await dependencies.repository.markSent(
        message.id,
        result.whatsappMessageId,
      );
    } catch (error) {
      throw new ProviderCommitError("Provider result was not committed", {
        cause: error,
      });
    }
  }
  const catalog = catalogContent(message);
  if (catalog) {
    let result;
    if (catalog.kind === "catalogProduct") {
      result = await providerCall(() => dependencies.provider.sendProduct({
        to: message.contactPhone,
        retailerId: catalog.product.retailerId,
        body: CATALOG_PRODUCT_MESSAGE_BODY,
        footer: CATALOG_MESSAGE_FOOTER,
      }));
    } else if (catalog.kind === "catalogProductList") {
      result = await providerCall(() => dependencies.provider.sendProductList({
        to: message.contactPhone,
        retailerIds: catalog.products.map((product) => product.retailerId),
        header: "Produtos selecionados",
        body: catalog.body,
        footer: CATALOG_MESSAGE_FOOTER,
        sectionTitle: "Produtos",
      }));
    } else {
      result = await providerCall(() => dependencies.provider.sendCatalog({
        to: message.contactPhone,
        body: catalog.body,
        thumbnailRetailerId: catalog.thumbnailRetailerId,
      }));
    }
    try {
      return await dependencies.repository.markSent(message.id, result.whatsappMessageId);
    } catch (error) {
      throw new ProviderCommitError("Provider result was not committed", {
        cause: error,
      });
    }
  }
  if (message.type === MessageType.TEXT) {
    const result = await providerCall(() => dependencies.provider.sendText({
      to: message.contactPhone,
      body: message.body!,
      contextMessageId: message.replyToWhatsappMessageId ?? undefined,
    }));
    return dependencies.repository.markSent(message.id, result.whatsappMessageId);
  }
  if (!message.mediaObject) throw new Error("Missing media");
  const mediaObject = message.mediaObject;
  const uploaded = await providerCall(() => dependencies.provider.uploadMedia({
    filename: mediaObject.originalFilename,
    mimeType: mediaObject.mimeType,
    sizeBytes: mediaObject.sizeBytes,
    open: () => dependencies.storage.open(mediaObject.storageKey),
  }));
  message = await dependencies.repository.setMediaMetaId(message.id, uploaded.mediaId);
  message = await dependencies.repository.markOperation(message.id, MessageOperationalState.SEND_IN_FLIGHT, new Date());
  const result = await providerCall(() => dependencies.provider.sendMedia({
    to: message.contactPhone,
    type: providerMediaType(message.type),
    mediaId: uploaded.mediaId,
    caption: message.body ?? undefined,
    filename: message.type === MessageType.DOCUMENT ? message.mediaObject!.originalFilename : undefined,
    contextMessageId: message.replyToWhatsappMessageId ?? undefined,
  }));
  return dependencies.repository.markSent(message.id, result.whatsappMessageId);
}

async function deliverAndCommit(
  message: MessageServiceRecord,
  dependencies: MessageServiceDependencies,
): Promise<MessageDto> {
  const concurrency = dependencies.concurrency ?? defaultConcurrency;
  return concurrency.run(message.sentByUserId, async () => {
    await connectionGuard(dependencies)();
    const clock = dependencies.now ?? (() => new Date());
    const leaseId = (dependencies.createUuid ?? randomUUID)();
    const now = clock();
    try {
      if (message.outboundPayloadKind === OutboundPayloadKind.FREE_FORM) {
        await freeFormGuard(dependencies)(message.conversationId, now);
      }
    } catch (error) {
      if (
        error instanceof HttpError &&
        (error.code === "WHATSAPP_SERVICE_WINDOW_CLOSED" ||
          error.code === "WHATSAPP_CONTACT_OPTED_OUT")
      ) {
        try {
          const failed = await dependencies.repository.markFailed(
            message.id,
            "Envio bloqueado pela política do WhatsApp",
            MessageOperationalState.LOCAL_FAILURE,
          );
          publishSafely(dependencies, {
            type: "message.status",
            conversationId: failed.conversationId,
            messageId: failed.id,
          });
        } catch {
          // A ausência de uma confirmação local nunca autoriza chamar a Meta.
        }
      }
      throw error;
    }
    const claimed = await dependencies.repository.claimReadyForDelivery(message.id, {
      leaseId,
      now,
      leaseUntil: new Date(now.getTime() + (dependencies.deliveryLeaseMs ?? DELIVERY_LEASE_MS)),
    });
    if (!claimed) {
      const current = (await dependencies.repository.findById(message.id)) ?? message;
      return toMessageDto(current);
    }

    let deliverable = claimed;
    if (catalogContent(claimed)) {
      try {
        deliverable = await refreshCatalogSnapshot(claimed, dependencies);
      } catch (error) {
        const failed = await dependencies.repository.markFailed(
          claimed.id,
          error instanceof HttpError ? error.message : safeFailureReason(error),
          MessageOperationalState.LOCAL_FAILURE,
        );
        publishSafely(dependencies, {
          type: "message.status",
          conversationId: failed.conversationId,
          messageId: failed.id,
        });
        return toMessageDto(failed);
      }
    }

    try {
      await connectionGuard(dependencies)();
    } catch (error) {
      await dependencies.repository.releaseDeliveryClaim(claimed.id, leaseId);
      throw error;
    }

    const rateReservation = dependencies.limiter.consume(deliverable.sentByUserId);
    if (!rateReservation) {
      const failed = await dependencies.repository.markFailed(
        claimed.id,
        "Limite de envios excedido",
        MessageOperationalState.LOCAL_FAILURE,
      );
      publishSafely(dependencies, { type: "message.status", conversationId: failed.conversationId, messageId: failed.id });
      throw new HttpError(429, "Limite de envios excedido");
    }

    const firstOperation = claimed.type === MessageType.TEXT || catalogContent(claimed)
      ? MessageOperationalState.SEND_IN_FLIGHT
      : MessageOperationalState.UPLOAD_IN_FLIGHT;
    let attemptCommit: ProviderAttemptCommitResult;
    try {
      attemptCommit = await dependencies.repository.markProviderAttempt(deliverable.id, leaseId, firstOperation, clock());
    } catch {
      dependencies.limiter.refund(rateReservation);
      await dependencies.repository.releaseDeliveryClaim(claimed.id, leaseId).catch(() => undefined);
      const current = (await dependencies.repository.findById(claimed.id).catch(() => null)) ?? claimed;
      publishSafely(dependencies, { type: "message.status", conversationId: current.conversationId, messageId: current.id });
      return toMessageDto(current);
    }
    if (attemptCommit === "CAS_LOST") {
      dependencies.limiter.refund(rateReservation);
      const current = (await dependencies.repository.findById(claimed.id)) ?? claimed;
      return toMessageDto(current);
    }
    const attempted = await dependencies.repository.findById(deliverable.id);
    if (!attempted) throw new Error("Committed provider attempt could not be hydrated");

    let final: MessageServiceRecord;
    try {
      final = await deliver(attempted, dependencies);
    } catch (error) {
      if (error instanceof ProviderCallError && error.cause instanceof WhatsAppProviderError && error.cause.kind === "rejected") {
        final = await dependencies.repository.markFailed(
          attempted.id,
          safeFailureReason(error.cause),
          MessageOperationalState.REJECTED,
        );
      } else if (error instanceof ProviderCallError) {
        try {
          final = await dependencies.repository.markOperation(attempted.id, MessageOperationalState.OUTCOME_UNKNOWN);
        } catch {
          final = (await dependencies.repository.findById(attempted.id)) ?? attempted;
        }
      } else if (error instanceof ProviderCommitError) {
        try {
          final = await dependencies.repository.markOperation(
            attempted.id,
            MessageOperationalState.OUTCOME_UNKNOWN,
          );
        } catch {
          final = (await dependencies.repository.findById(attempted.id)) ?? attempted;
        }
      } else {
        final = (await dependencies.repository.findById(attempted.id)) ?? attempted;
      }
    }
    publishSafely(dependencies, { type: "message.status", conversationId: final.conversationId, messageId: final.id });
    return toMessageDto(final);
  });
}

type MediaSendMessageInput = Exclude<SendMessageInput, { type: "TEXT" }>;

async function validateOutboundFile(input: MediaSendMessageInput): Promise<MessageFileInput> {
  const filename = safeOriginalFilename(input.file.filename);
  const validated = "path" in input.file && input.file.path
    ? await validateMediaFile({ path: input.file.path, filename, mimeType: input.file.mimeType })
    : validateMedia({ bytes: input.file.bytes!, filename, mimeType: input.file.mimeType });
  if (validated.kind.toUpperCase() !== input.type) {
    throw new HttpError(400, "Tipo de mensagem incompatível com o arquivo");
  }
  return { ...input.file, filename, mimeType: validated.mimeType } as MessageFileInput;
}

async function storeOutboundFile(file: MessageFileInput, dependencies: MessageServiceDependencies) {
  return "path" in file && file.path
    ? dependencies.storage.putStream({
        filename: file.filename,
        mimeType: file.mimeType,
        maximumBytes: Number(file.sizeBytes),
        stream: Readable.toWeb(createReadStream(file.path)) as ReadableStream<Uint8Array>,
      })
    : dependencies.storage.put({ filename: file.filename, mimeType: file.mimeType, bytes: file.bytes! });
}

function assertStoredMatchesStaging(file: MessageFileInput, stored: { sizeBytes: bigint; sha256: string }): void {
  if ("path" in file && file.path && (stored.sizeBytes !== file.sizeBytes || stored.sha256 !== file.sha256)) {
    throw new Error("Staged media changed");
  }
}

async function sendMessageOnce(
  actor: SessionUser,
  conversationId: string,
  input: SendMessageInput,
  dependencies: MessageServiceDependencies,
): Promise<MessageDto> {
  const parsedActorId = messageUuidSchema.parse(actor.id);
  const parsedConversationId = messageUuidSchema.parse(conversationId);
  const parsed = input.type === MessageType.TEXT
    ? outboundTextSchema.parse(input)
    : outboundMediaFieldsSchema.parse(input);
  const clientRequestId = clientRequestIdSchema.parse(parsed.clientRequestId);
  const clock = dependencies.now ?? (() => new Date());
  const existing = await dependencies.repository.findByClientRequestId(clientRequestId);
  if (existing) {
    assertSameIdempotentOperation(
      existing,
      actor,
      parsedConversationId,
      parsed.replyToMessageId,
    );
    if (existing.type !== input.type) throw new HttpError(409, "Identificador de envio já utilizado");
    if (existing.status === MessageStatus.PENDING && existing.operationalState === MessageOperationalState.READY &&
      (existing.type === MessageType.TEXT || existing.mediaObject)) {
      return deliverAndCommit(existing, dependencies);
    }
    const repairableMedia = input.type !== MessageType.TEXT && !existing.mediaObject && (
      (existing.status === MessageStatus.FAILED && existing.operationalState === MessageOperationalState.LOCAL_FAILURE) ||
      (existing.status === MessageStatus.PENDING && existing.operationalState === MessageOperationalState.READY)
    );
    if (repairableMedia) {
      await connectionGuard(dependencies)();
      await freeFormGuard(dependencies)(
        parsedConversationId,
        clock(),
      );
      const validatedFile = await validateOutboundFile(input);
      let storedKey: string | undefined;
      let attachStarted = false;
      try {
        const stored = await storeOutboundFile(validatedFile, dependencies);
        storedKey = stored.key;
        assertStoredMatchesStaging(validatedFile, stored);
        attachStarted = true;
        const attachment = await dependencies.repository.attachStoredMedia(existing.id, {
          storageKey: stored.key,
          originalFilename: validatedFile.filename,
          mimeType: validatedFile.mimeType,
          sizeBytes: stored.sizeBytes,
          sha256: stored.sha256,
        });
        if (attachment === "CAS_LOST") {
          await dependencies.storage.remove(stored.key).catch(() => undefined);
          return toMessageDto((await dependencies.repository.findById(existing.id)) ?? existing);
        }
        if (attachment === "NO_COMMIT") {
          await dependencies.storage.remove(stored.key).catch(() => undefined);
          storedKey = undefined;
          attachStarted = false;
          throw new Error("Media attachment was not committed");
        }
        if (attachment === "COMMIT_UNKNOWN") {
          const uncertain = await dependencies.repository.markFailed(
            existing.id,
            "Estado da mídia requer reconciliação",
            MessageOperationalState.LOCAL_FAILURE,
          );
          publishSafely(dependencies, { type: "message.status", conversationId: uncertain.conversationId, messageId: uncertain.id });
          return toMessageDto(uncertain);
        }
        const repaired = await dependencies.repository.findById(existing.id);
        if (!repaired) throw new Error("Committed media attachment could not be hydrated");
        return deliverAndCommit(repaired, dependencies);
      } catch (error) {
        if (storedKey && !attachStarted) await dependencies.storage.remove(storedKey).catch(() => undefined);
        if (attachStarted) throw error;
        return toMessageDto((await dependencies.repository.findById(existing.id)) ?? existing);
      }
    }
    return toMessageDto(existing);
  }
  await connectionGuard(dependencies)();
  await freeFormGuard(dependencies)(parsedConversationId, clock());
  let validatedFile: MessageFileInput | undefined;
  if (input.type !== MessageType.TEXT) {
    validatedFile = await validateOutboundFile(input);
  }
  const created = await dependencies.repository.createPending({
    conversationId: parsedConversationId,
    clientRequestId,
    sentByUserId: parsedActorId,
    type: input.type,
    body: parsed.body ?? null,
    replyToMessageId: parsed.replyToMessageId ?? null,
    externalTimestamp: clock(),
  });
  if (!created.created) {
    assertSameIdempotentOperation(
      created.message,
      actor,
      parsedConversationId,
      parsed.replyToMessageId,
    );
    return toMessageDto(created.message);
  }
  let message = created.message;
  publishSafely(dependencies, { type: "message.created", conversationId: message.conversationId, messageId: message.id });
  if (validatedFile) {
    let storedKey: string | undefined;
    let attachStarted = false;
    try {
      const stored = await storeOutboundFile(validatedFile, dependencies);
      storedKey = stored.key;
      assertStoredMatchesStaging(validatedFile, stored);
      attachStarted = true;
      const attachment = await dependencies.repository.attachStoredMedia(message.id, {
        storageKey: stored.key,
        originalFilename: validatedFile.filename,
        mimeType: validatedFile.mimeType,
        sizeBytes: stored.sizeBytes,
        sha256: stored.sha256,
      });
      if (attachment === "CAS_LOST") {
        await dependencies.storage.remove(stored.key).catch(() => undefined);
        return toMessageDto((await dependencies.repository.findById(message.id)) ?? message);
      }
      if (attachment === "NO_COMMIT") {
        await dependencies.storage.remove(stored.key).catch(() => undefined);
        storedKey = undefined;
        attachStarted = false;
        throw new Error("Media attachment was not committed");
      }
      if (attachment === "COMMIT_UNKNOWN") {
        const uncertain = await dependencies.repository.markFailed(
          message.id,
          "Estado da mídia requer reconciliação",
          MessageOperationalState.LOCAL_FAILURE,
        );
        publishSafely(dependencies, { type: "message.status", conversationId: uncertain.conversationId, messageId: uncertain.id });
        return toMessageDto(uncertain);
      }
      const attached = await dependencies.repository.findById(message.id);
      if (!attached) throw new Error("Committed media attachment could not be hydrated");
      message = attached;
    } catch (error) {
      if (storedKey && !attachStarted) await dependencies.storage.remove(storedKey).catch(() => undefined);
      if (attachStarted) throw error;
      const failed = await dependencies.repository.markFailed(
        message.id,
        safeFailureReason(error),
        MessageOperationalState.LOCAL_FAILURE,
      );
      publishSafely(dependencies, { type: "message.status", conversationId: failed.conversationId, messageId: failed.id });
      return toMessageDto(failed);
    }
  }
  return deliverAndCommit(message, dependencies);
}

export function sendMessage(
  actor: SessionUser,
  conversationId: string,
  input: SendMessageInput,
  dependencies: MessageServiceDependencies = defaultDependencies,
): Promise<MessageDto> {
  const operationKey = [
    actor.id,
    conversationId,
    clientRequestIdSchema.parse(input.clientRequestId),
    input.replyToMessageId ?? "-",
  ].join(":");
  const inFlight = dependencies.idempotencyInFlight ?? defaultIdempotencyInFlight;
  const existing = inFlight.get(operationKey);
  if (existing) return existing;

  let operation: Promise<MessageDto>;
  operation = sendMessageOnce(actor, conversationId, input, dependencies).finally(() => {
    if (inFlight.get(operationKey) === operation) inFlight.delete(operationKey);
  });
  inFlight.set(operationKey, operation);
  return operation;
}

function assertPreparedCatalogIdentity(
  message: MessageServiceRecord,
  actor: SessionUser,
  conversationId: string,
  input: PreparedCatalogMessageInput,
): void {
  assertSameIdempotentOperation(message, actor, conversationId, undefined);
  const storedContent = catalogContent(message);
  const storedRetailerIds = storedContent ? catalogRetailerIds(storedContent) : [];
  const requestedRetailerIds = catalogRetailerIds(input.content);
  if (
    message.outboundPayloadKind !== OutboundPayloadKind.FREE_FORM ||
    message.type !== MessageType.INTERACTIVE ||
    storedContent?.kind !== input.content.kind ||
    storedRetailerIds.length !== requestedRetailerIds.length ||
    storedRetailerIds.some((retailerId, index) => retailerId !== requestedRetailerIds[index])
  ) {
    throw new HttpError(409, "Identificador de envio já utilizado");
  }
}

export async function sendPreparedCatalogMessage(
  actor: SessionUser,
  conversationId: string,
  input: PreparedCatalogMessageInput,
  dependencies: MessageServiceDependencies = defaultDependencies,
): Promise<MessageDto> {
  const actorId = messageUuidSchema.parse(actor.id);
  const parsedConversationId = messageUuidSchema.parse(conversationId);
  const clientRequestId = clientRequestIdSchema.parse(input.clientRequestId);
  const normalizedBody = typeof input.body === "string" ? input.body.trim() : "";
  if (!normalizedBody || normalizedBody.length > 4_096) {
    throw new HttpError(400, "Mensagem de catálogo inválida");
  }
  const parsedContent = parseMessageContent(input.content);
  if (
    !parsedContent ||
    (parsedContent.kind !== "catalog" &&
      parsedContent.kind !== "catalogProduct" &&
      parsedContent.kind !== "catalogProductList")
  ) {
    throw new HttpError(400, "Mensagem de catálogo inválida");
  }
  const prepared: PreparedCatalogMessageInput = {
    clientRequestId,
    body: normalizedBody,
    content: parsedContent,
  };

  const existing = await dependencies.repository.findByClientRequestId(clientRequestId);
  if (existing) {
    assertPreparedCatalogIdentity(existing, actor, parsedConversationId, prepared);
    if (
      existing.status === MessageStatus.PENDING &&
      existing.operationalState === MessageOperationalState.READY
    ) {
      return deliverAndCommit(existing, dependencies);
    }
    return toMessageDto(existing);
  }

  const clock = dependencies.now ?? (() => new Date());
  await connectionGuard(dependencies)();
  await freeFormGuard(dependencies)(parsedConversationId, clock());
  const created = await dependencies.repository.createPending({
    conversationId: parsedConversationId,
    clientRequestId,
    sentByUserId: actorId,
    type: MessageType.INTERACTIVE,
    body: prepared.body,
    content: prepared.content,
    replyToMessageId: null,
    externalTimestamp: clock(),
  });
  assertPreparedCatalogIdentity(
    created.message,
    actor,
    parsedConversationId,
    prepared,
  );
  if (created.created) {
    publishSafely(dependencies, {
      type: "message.created",
      conversationId: created.message.conversationId,
      messageId: created.message.id,
    });
  }
  if (
    created.message.status === MessageStatus.PENDING &&
    created.message.operationalState === MessageOperationalState.READY
  ) {
    return deliverAndCommit(created.message, dependencies);
  }
  return toMessageDto(created.message);
}

function assertPreparedTemplateIdentity(
  message: MessageServiceRecord,
  actor: SessionUser,
  conversationId: string,
  input: PreparedTemplateMessageInput,
): void {
  assertSameIdempotentOperation(message, actor, conversationId, undefined);
  if (
    message.outboundPayloadKind !== OutboundPayloadKind.TEMPLATE ||
    message.type !== MessageType.TEXT ||
    message.body !== input.body ||
    message.templateName !== input.payload.name ||
    message.templateLanguage !== input.payload.language ||
    message.templateDefinitionHash !== input.payload.definitionHash ||
    preparedBodyParameters(message)[0].text !==
      input.payload.bodyParameters[0].text
  ) {
    throw new HttpError(409, "Identificador de envio já utilizado");
  }
}

export async function sendPreparedTemplateMessage(
  actor: SessionUser,
  conversationId: string,
  input: PreparedTemplateMessageInput,
  dependencies: MessageServiceDependencies = defaultDependencies,
): Promise<MessageServiceRecord> {
  const parsedActorId = messageUuidSchema.parse(actor.id);
  const parsedConversationId = messageUuidSchema.parse(conversationId);
  const clientRequestId = clientRequestIdSchema.parse(input.clientRequestId);
  const existing = await dependencies.repository.findByClientRequestId(
    clientRequestId,
  );
  if (existing) {
    assertPreparedTemplateIdentity(
      existing,
      actor,
      parsedConversationId,
      input,
    );
    if (
      existing.status === MessageStatus.PENDING &&
      existing.operationalState === MessageOperationalState.READY
    ) {
      await deliverAndCommit(existing, dependencies);
      return (await dependencies.repository.findById(existing.id)) ?? existing;
    }
    return existing;
  }

  await connectionGuard(dependencies)();
  const created = await dependencies.repository.createPending({
    conversationId: parsedConversationId,
    clientRequestId,
    sentByUserId: parsedActorId,
    type: MessageType.TEXT,
    body: input.body,
    replyToMessageId: null,
    externalTimestamp: (dependencies.now ?? (() => new Date()))(),
    payload: input.payload,
  });
  assertPreparedTemplateIdentity(
    created.message,
    actor,
    parsedConversationId,
    input,
  );
  if (created.created) {
    publishSafely(dependencies, {
      type: "message.created",
      conversationId: created.message.conversationId,
      messageId: created.message.id,
    });
  }
  if (
    created.message.status === MessageStatus.PENDING &&
    created.message.operationalState === MessageOperationalState.READY
  ) {
    await deliverAndCommit(created.message, dependencies);
  }
  return (
    (await dependencies.repository.findById(created.message.id)) ??
    created.message
  );
}

export async function retryMessage(
  actor: SessionUser,
  messageId: string,
  dependencies: MessageServiceDependencies = defaultDependencies,
): Promise<MessageDto> {
  const actorId = messageUuidSchema.parse(actor.id);
  const parsedMessageId = messageUuidSchema.parse(messageId);
  const current = await dependencies.repository.findById(parsedMessageId);
  if (!current) throw new HttpError(404, "Mensagem não encontrada");
  if (current.direction !== MessageDirection.OUTBOUND || current.status !== MessageStatus.FAILED) {
    throw new HttpError(409, "Somente mensagens enviadas com falha podem ser reenviadas");
  }
  if (
    current.type !== MessageType.TEXT &&
    !catalogContent(current) &&
    !current.mediaObject
  ) {
    throw new HttpError(409, "A mídia original não está disponível; envie um novo arquivo");
  }
  if (current.outboundPayloadKind === OutboundPayloadKind.TEMPLATE) {
    throw new HttpError(
      409,
      "Mensagens de retomada não podem ser reenviadas automaticamente",
    );
  }
  const clock = dependencies.now ?? (() => new Date());
  await freeFormGuard(dependencies)(
    current.conversationId,
    clock(),
  );
  await connectionGuard(dependencies)();
  const claimed = await dependencies.repository.claimFailedForRetry(parsedMessageId);
  if (!claimed) throw new HttpError(409, "Mensagem já está sendo reenviada");
  publishSafely(dependencies, { type: "message.status", conversationId: claimed.conversationId, messageId: claimed.id });
  return deliverAndCommit(claimed, dependencies);
}
