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
  type MessageType as MessageTypeValue,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/http";
import type { SessionUser } from "@/modules/auth/session";
import type { MessageDto } from "@/modules/conversations/types";
import { LocalMediaStorage } from "@/modules/media/local-storage";
import type { MediaStorage } from "@/modules/media/storage";
import { validateMedia, validateMediaFile } from "@/modules/media/validation";
import type { RealtimeEvent } from "@/modules/realtime/events";
import { publishRealtime } from "@/modules/realtime/hub";
import { getServerEnv } from "@/lib/env";
import { getWhatsAppProvider } from "@/modules/whatsapp/factory";
import { WhatsAppProviderError } from "@/modules/whatsapp/meta-provider";
import type { MediaMessageType, WhatsAppProvider } from "@/modules/whatsapp/provider";

import {
  clientRequestIdSchema,
  messageUuidSchema,
  outboundMediaFieldsSchema,
  outboundTextSchema,
} from "./schemas";
import { safeFailureReason, safeOriginalFilename } from "./status";

export const MESSAGE_SEND_RATE_LIMIT = 30;
export const MESSAGE_SEND_RATE_WINDOW_MS = 60_000;

export type MessageFileInput = {
  filename: string;
  mimeType: string;
} & (
  | { bytes: Uint8Array; path?: never; sizeBytes?: never; sha256?: never; cleanup?: never }
  | { path: string; sizeBytes: bigint; sha256: string; cleanup(): Promise<void>; bytes?: never }
);

export type SendMessageInput =
  | { type: "TEXT"; clientRequestId: string; body: string }
  | {
      type: "IMAGE" | "AUDIO" | "VIDEO" | "DOCUMENT";
      clientRequestId: string;
      body?: string;
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
  clientRequestId: string;
  direction: MessageDirection;
  type: MessageTypeValue;
  body: string | null;
  mediaObjectId: string | null;
  sentByUserId: string;
  sentByUser: { id: string; name: string };
  status: MessageStatus;
  failureReason: string | null;
  operationalState: MessageOperationalState;
  providerAttemptedAt: Date | null;
  externalTimestamp: Date;
  createdAt: Date;
  contactPhone: string;
  mediaObject: MessageMediaRecord | null;
};

export type PendingMessageInput = {
  conversationId: string;
  clientRequestId: string;
  sentByUserId: string;
  type: MessageTypeValue;
  body: string | null;
  externalTimestamp: Date;
};

export type StoredMessageMediaInput = {
  storageKey: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: bigint;
  sha256: string;
};

export interface MessageServiceRepository {
  findByClientRequestId(clientRequestId: string): Promise<MessageServiceRecord | null>;
  createPending(input: PendingMessageInput): Promise<{ message: MessageServiceRecord; created: boolean }>;
  attachStoredMedia(messageId: string, input: StoredMessageMediaInput): Promise<MessageServiceRecord>;
  setMediaMetaId(messageId: string, metaMediaId: string): Promise<MessageServiceRecord>;
  markOperation(messageId: string, operationalState: MessageOperationalState, attemptedAt?: Date | null): Promise<MessageServiceRecord>;
  markSent(messageId: string, whatsappMessageId: string): Promise<MessageServiceRecord>;
  markFailed(messageId: string, failureReason: string, operationalState: MessageOperationalState): Promise<MessageServiceRecord>;
  findById(messageId: string): Promise<MessageServiceRecord | null>;
  claimFailedForRetry(messageId: string): Promise<MessageServiceRecord | null>;
}

export class MessageSendRateLimiter {
  private readonly attempts = new Map<string, number[]>();

  consume(userId: string, now = new Date()): boolean {
    const boundary = now.getTime() - MESSAGE_SEND_RATE_WINDOW_MS;
    const active = (this.attempts.get(userId) ?? []).filter((time) => time > boundary);
    if (active.length >= MESSAGE_SEND_RATE_LIMIT) {
      this.attempts.set(userId, active);
      return false;
    }
    active.push(now.getTime());
    this.attempts.set(userId, active);
    return true;
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
};

const prismaMessageScalarSelect = {
  id: true,
  conversationId: true,
  whatsappMessageId: true,
  clientRequestId: true,
  direction: true,
  type: true,
  body: true,
  mediaObjectId: true,
  sentByUserId: true,
  status: true,
  failureReason: true,
  operationalState: true,
  providerAttemptedAt: true,
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
  if (!contact) throw new Error("Invalid outbound conversation contact");
  return {
    id: row.id,
    conversationId: row.conversationId,
    whatsappMessageId: row.whatsappMessageId,
    clientRequestId: row.clientRequestId,
    direction: row.direction,
    type: row.type,
    body: row.body,
    mediaObjectId: row.mediaObjectId,
    sentByUserId: row.sentByUserId,
    sentByUser,
    status: row.status,
    failureReason: row.failureReason,
    operationalState: row.operationalState,
    providerAttemptedAt: row.providerAttemptedAt,
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
      await prisma.$executeRaw(Prisma.sql`
        WITH inserted AS (
          INSERT INTO "messages" (
            "id", "conversation_id", "client_request_id", "direction", "type",
            "body", "sent_by_user_id", "status", "external_timestamp",
            "created_at", "updated_at"
          ) VALUES (
            ${messageId}::uuid,
            ${input.conversationId}::uuid,
            ${input.clientRequestId}::uuid,
            ${MessageDirection.OUTBOUND}::"MessageDirection",
            ${input.type}::"MessageType",
            ${input.body},
            ${input.sentByUserId}::uuid,
            ${MessageStatus.PENDING}::"MessageStatus",
            ${input.externalTimestamp},
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
          )
          RETURNING "conversation_id"
        )
        UPDATE "conversations"
        SET
          "last_message_at" = GREATEST("last_message_at", ${input.externalTimestamp}),
          "updated_at" = CURRENT_TIMESTAMP
        FROM inserted
        WHERE "conversations"."id" = inserted."conversation_id"
      `);
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
    const messageIdResult = await prisma.$transaction(async (transaction) => {
      const media = await transaction.mediaObject.create({
        data: {
          storageProvider: "local",
          storageKey: input.storageKey,
          originalFilename: input.originalFilename,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          sha256: input.sha256,
          status: MediaStatus.AVAILABLE,
        },
        select: { id: true },
      });
      return transaction.message.update({
        where: { id: messageId },
        data: { mediaObjectId: media.id },
        select: { id: true },
      });
    });
    return this.findById(messageIdResult.id).then((message) => message!);
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
  async markSent(messageId, whatsappMessageId) {
    const row = await prisma.message.update({
      where: { id: messageId },
      data: { whatsappMessageId, status: MessageStatus.SENT, failureReason: null, operationalState: MessageOperationalState.SENT },
      select: prismaMessageScalarSelect,
    });
    return hydrateServiceRecord(row);
  },
  async markFailed(messageId, failureReason, operationalState) {
    const row = await prisma.message.update({
      where: { id: messageId },
      data: { status: MessageStatus.FAILED, failureReason, operationalState },
      select: prismaMessageScalarSelect,
    });
    return hydrateServiceRecord(row);
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
        data: { status: MessageStatus.PENDING, failureReason: null, operationalState: MessageOperationalState.READY },
      });
      if (claimed.count !== 1) return null;
      return messageId;
    });
    return claimedId ? this.findById(claimedId) : null;
  },
};

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
};

function toMessageDto(message: MessageServiceRecord): MessageDto {
  return {
    id: message.id,
    direction: message.direction,
    type: message.type,
    body: message.body,
    mediaObjectId: message.mediaObjectId,
    sentBy: { id: message.sentByUser.id, name: message.sentByUser.name },
    status: message.status,
    failureReason: message.failureReason,
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

function assertSameIdempotentOperation(message: MessageServiceRecord, actor: SessionUser, conversationId: string): void {
  if (message.conversationId !== conversationId || message.sentByUserId !== actor.id) {
    throw new HttpError(409, "Identificador de envio já utilizado");
  }
}

function providerMediaType(type: MessageTypeValue): MediaMessageType {
  const value = type.toLowerCase();
  if (value === "image" || value === "audio" || value === "video" || value === "document") return value;
  throw new Error("Unsupported media message type");
}

class ProviderCallError extends Error {
  constructor(public readonly cause: unknown) {
    super("Provider call failed");
    this.name = "ProviderCallError";
  }
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
  if (message.type === MessageType.TEXT) {
    message = await dependencies.repository.markOperation(message.id, MessageOperationalState.SEND_IN_FLIGHT, new Date());
    const result = await providerCall(() => dependencies.provider.sendText({ to: message.contactPhone, body: message.body! }));
    return dependencies.repository.markSent(message.id, result.whatsappMessageId);
  }
  if (!message.mediaObject) throw new Error("Missing media");
  const mediaObject = message.mediaObject;
  message = await dependencies.repository.markOperation(message.id, MessageOperationalState.UPLOAD_IN_FLIGHT, new Date());
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
  }));
  return dependencies.repository.markSent(message.id, result.whatsappMessageId);
}

async function deliverAndCommit(
  message: MessageServiceRecord,
  dependencies: MessageServiceDependencies,
): Promise<MessageDto> {
  const concurrency = dependencies.concurrency ?? defaultConcurrency;
  return concurrency.run(message.sentByUserId, async () => {
    if (!dependencies.limiter.consume(message.sentByUserId)) {
      const failed = await dependencies.repository.markFailed(
        message.id,
        "Limite de envios excedido",
        MessageOperationalState.LOCAL_FAILURE,
      );
      publishSafely(dependencies, { type: "message.status", conversationId: failed.conversationId, messageId: failed.id });
      throw new HttpError(429, "Limite de envios excedido");
    }

    let final: MessageServiceRecord;
    try {
      final = await deliver(message, dependencies);
    } catch (error) {
      if (error instanceof ProviderCallError && error.cause instanceof WhatsAppProviderError && error.cause.kind === "rejected") {
        final = await dependencies.repository.markFailed(
          message.id,
          safeFailureReason(error.cause),
          MessageOperationalState.REJECTED,
        );
      } else if (error instanceof ProviderCallError) {
        try {
          final = await dependencies.repository.markOperation(message.id, MessageOperationalState.OUTCOME_UNKNOWN);
        } catch {
          final = (await dependencies.repository.findById(message.id)) ?? message;
        }
      } else {
        final = (await dependencies.repository.findById(message.id)) ?? message;
      }
    }
    publishSafely(dependencies, { type: "message.status", conversationId: final.conversationId, messageId: final.id });
    return toMessageDto(final);
  });
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
  const existing = await dependencies.repository.findByClientRequestId(clientRequestId);
  if (existing) {
    assertSameIdempotentOperation(existing, actor, parsedConversationId);
    return toMessageDto(existing);
  }
  let validatedFile: MessageFileInput | undefined;
  if (input.type !== MessageType.TEXT) {
    const filename = safeOriginalFilename(input.file.filename);
    const validated = "path" in input.file && input.file.path
      ? await validateMediaFile({ path: input.file.path, filename, mimeType: input.file.mimeType })
      : validateMedia({ bytes: input.file.bytes!, filename, mimeType: input.file.mimeType });
    const expectedType = validated.kind.toUpperCase();
    if (expectedType !== input.type) throw new HttpError(400, "Tipo de mensagem incompatível com o arquivo");
    validatedFile = { ...input.file, filename, mimeType: validated.mimeType } as MessageFileInput;
  }
  const created = await dependencies.repository.createPending({
    conversationId: parsedConversationId,
    clientRequestId,
    sentByUserId: parsedActorId,
    type: input.type,
    body: parsed.body ?? null,
    externalTimestamp: new Date(),
  });
  if (!created.created) {
    assertSameIdempotentOperation(created.message, actor, parsedConversationId);
    return toMessageDto(created.message);
  }
  let message = created.message;
  publishSafely(dependencies, { type: "message.created", conversationId: message.conversationId, messageId: message.id });
  if (validatedFile) {
    let storedKey: string | undefined;
    try {
      const stored = "path" in validatedFile && validatedFile.path
        ? await dependencies.storage.putStream({
            filename: validatedFile.filename,
            mimeType: validatedFile.mimeType,
            maximumBytes: Number(validatedFile.sizeBytes),
            stream: Readable.toWeb(createReadStream(validatedFile.path)) as ReadableStream<Uint8Array>,
          })
        : await dependencies.storage.put({
            filename: validatedFile.filename,
            mimeType: validatedFile.mimeType,
            bytes: validatedFile.bytes!,
          });
      storedKey = stored.key;
      if (
        "path" in validatedFile && validatedFile.path &&
        (stored.sizeBytes !== validatedFile.sizeBytes || stored.sha256 !== validatedFile.sha256)
      ) throw new Error("Staged media changed");
      message = await dependencies.repository.attachStoredMedia(message.id, {
        storageKey: stored.key,
        originalFilename: validatedFile.filename,
        mimeType: validatedFile.mimeType,
        sizeBytes: stored.sizeBytes,
        sha256: stored.sha256,
      });
    } catch (error) {
      if (storedKey) await dependencies.storage.remove(storedKey).catch(() => undefined);
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
  const operationKey = `${actor.id}:${conversationId}:${clientRequestIdSchema.parse(input.clientRequestId)}`;
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
  if (current.type !== MessageType.TEXT && !current.mediaObject) {
    throw new HttpError(409, "A mídia original não está disponível; envie um novo arquivo");
  }
  const claimed = await dependencies.repository.claimFailedForRetry(parsedMessageId);
  if (!claimed) throw new HttpError(409, "Mensagem já está sendo reenviada");
  publishSafely(dependencies, { type: "message.status", conversationId: claimed.conversationId, messageId: claimed.id });
  return deliverAndCommit(claimed, dependencies);
}
