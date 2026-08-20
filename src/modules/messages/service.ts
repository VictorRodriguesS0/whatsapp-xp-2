import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";
import {
  MediaStatus,
  MessageDirection,
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
import { validateMedia } from "@/modules/media/validation";
import type { RealtimeEvent } from "@/modules/realtime/events";
import { publishRealtime } from "@/modules/realtime/hub";
import { getServerEnv } from "@/lib/env";
import { getWhatsAppProvider } from "@/modules/whatsapp/factory";
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
  bytes: Uint8Array;
  filename: string;
  mimeType: string;
};

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
  markSent(messageId: string, whatsappMessageId: string): Promise<MessageServiceRecord>;
  markFailed(messageId: string, failureReason: string): Promise<MessageServiceRecord>;
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

export type MessageServiceDependencies = {
  repository: MessageServiceRepository;
  storage: MediaStorage;
  provider: WhatsAppProvider;
  limiter: MessageSendRateLimiter;
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

const prismaRepository: MessageServiceRepository = {
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
  async markSent(messageId, whatsappMessageId) {
    const row = await prisma.message.update({
      where: { id: messageId },
      data: { whatsappMessageId, status: MessageStatus.SENT, failureReason: null },
      select: prismaMessageScalarSelect,
    });
    return hydrateServiceRecord(row);
  },
  async markFailed(messageId, failureReason) {
    const row = await prisma.message.update({
      where: { id: messageId },
      data: { status: MessageStatus.FAILED, failureReason },
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
        where: { id: messageId, direction: MessageDirection.OUTBOUND, status: MessageStatus.FAILED },
        data: { status: MessageStatus.PENDING, failureReason: null },
      });
      if (claimed.count !== 1) return null;
      return messageId;
    });
    return claimedId ? this.findById(claimedId) : null;
  },
};

const defaultLimiter = new MessageSendRateLimiter();
const defaultIdempotencyInFlight = new Map<string, Promise<MessageDto>>();
const defaultDependencies: MessageServiceDependencies = {
  repository: prismaRepository,
  storage: new LocalMediaStorage(getServerEnv().MEDIA_ROOT),
  provider: getWhatsAppProvider(),
  limiter: defaultLimiter,
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

async function readStoredBytes(storage: MediaStorage, media: MessageMediaRecord): Promise<Uint8Array> {
  const stream = await storage.open(media.storageKey);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (BigInt(total) > media.sizeBytes) throw new Error("Stored media size mismatch");
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (BigInt(total) !== media.sizeBytes) throw new Error("Stored media size mismatch");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (createHash("sha256").update(bytes).digest("hex") !== media.sha256) throw new Error("Stored media hash mismatch");
  validateMedia({ bytes, mimeType: media.mimeType, filename: media.originalFilename });
  return bytes;
}

function providerMediaType(type: MessageTypeValue): MediaMessageType {
  const value = type.toLowerCase();
  if (value === "image" || value === "audio" || value === "video" || value === "document") return value;
  throw new Error("Unsupported media message type");
}

async function deliver(
  message: MessageServiceRecord,
  dependencies: MessageServiceDependencies,
  suppliedBytes?: Uint8Array,
): Promise<MessageServiceRecord> {
  if (message.type === MessageType.TEXT) {
    const result = await dependencies.provider.sendText({ to: message.contactPhone, body: message.body! });
    return dependencies.repository.markSent(message.id, result.whatsappMessageId);
  }
  if (!message.mediaObject) throw new Error("Missing media");
  const bytes = suppliedBytes ?? (await readStoredBytes(dependencies.storage, message.mediaObject));
  const uploaded = await dependencies.provider.uploadMedia({
    bytes,
    filename: message.mediaObject.originalFilename,
    mimeType: message.mediaObject.mimeType,
  });
  message = await dependencies.repository.setMediaMetaId(message.id, uploaded.mediaId);
  const result = await dependencies.provider.sendMedia({
    to: message.contactPhone,
    type: providerMediaType(message.type),
    mediaId: uploaded.mediaId,
    caption: message.body ?? undefined,
    filename: message.type === MessageType.DOCUMENT ? message.mediaObject!.originalFilename : undefined,
  });
  return dependencies.repository.markSent(message.id, result.whatsappMessageId);
}

async function deliverAndCommit(
  message: MessageServiceRecord,
  dependencies: MessageServiceDependencies,
  suppliedBytes?: Uint8Array,
): Promise<MessageDto> {
  let final: MessageServiceRecord;
  try {
    final = await deliver(message, dependencies, suppliedBytes);
  } catch (error) {
    final = await dependencies.repository.markFailed(message.id, safeFailureReason(error));
  }
  publishSafely(dependencies, { type: "message.status", conversationId: final.conversationId, messageId: final.id });
  return toMessageDto(final);
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
  let validatedFile: { bytes: Uint8Array; filename: string; mimeType: string } | undefined;
  if (input.type !== MessageType.TEXT) {
    const filename = safeOriginalFilename(input.file.filename);
    const validated = validateMedia({ bytes: input.file.bytes, filename, mimeType: input.file.mimeType });
    const expectedType = validated.kind.toUpperCase();
    if (expectedType !== input.type) throw new HttpError(400, "Tipo de mensagem incompatível com o arquivo");
    validatedFile = { bytes: input.file.bytes, filename, mimeType: validated.mimeType };
  }
  if (!dependencies.limiter.consume(parsedActorId)) throw new HttpError(429, "Limite de envios excedido");
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
    try {
      const stored = await dependencies.storage.put(validatedFile);
      message = await dependencies.repository.attachStoredMedia(message.id, {
        storageKey: stored.key,
        originalFilename: validatedFile.filename,
        mimeType: validatedFile.mimeType,
        sizeBytes: stored.sizeBytes,
        sha256: stored.sha256,
      });
    } catch (error) {
      const failed = await dependencies.repository.markFailed(message.id, safeFailureReason(error));
      publishSafely(dependencies, { type: "message.status", conversationId: failed.conversationId, messageId: failed.id });
      return toMessageDto(failed);
    }
  }
  return deliverAndCommit(message, dependencies, validatedFile?.bytes);
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
  if (!dependencies.limiter.consume(actorId)) throw new HttpError(429, "Limite de envios excedido");
  const claimed = await dependencies.repository.claimFailedForRetry(parsedMessageId);
  if (!claimed) throw new HttpError(409, "Mensagem já está sendo reenviada");
  publishSafely(dependencies, { type: "message.status", conversationId: claimed.conversationId, messageId: claimed.id });
  return deliverAndCommit(claimed, dependencies);
}
