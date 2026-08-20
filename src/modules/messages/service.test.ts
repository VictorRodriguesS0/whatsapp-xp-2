// @vitest-environment node

import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  MessageDirection,
  MessageStatus,
  MessageType,
  UserRole,
} from "@/generated/prisma/enums";
import type { MediaStorage } from "@/modules/media/storage";
import type { SessionUser } from "@/modules/auth/session";
import type { WhatsAppProvider } from "@/modules/whatsapp/provider";

import {
  MessageSendRateLimiter,
  retryMessage,
  sendMessage,
  type MessageServiceDependencies,
  type MessageServiceRecord,
  type MessageServiceRepository,
  type PendingMessageInput,
  type StoredMessageMediaInput,
} from "./service";

const actor: SessionUser = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Victor",
  email: "victor@example.test",
  role: UserRole.ADMIN,
};
const conversationId = "10000000-0000-4000-8000-000000000001";

class MemoryRepository implements MessageServiceRepository {
  readonly records = new Map<string, MessageServiceRecord>();
  readonly clientIds = new Map<string, string>();
  readonly history: string[] = [];
  private sequence = 0;

  async findByClientRequestId(clientRequestId: string) {
    const id = this.clientIds.get(clientRequestId);
    return id ? this.records.get(id)! : null;
  }

  async createPending(input: PendingMessageInput) {
    const existingId = this.clientIds.get(input.clientRequestId);
    const existing = existingId ? this.records.get(existingId)! : null;
    if (existing) return { message: existing, created: false };
    this.sequence += 1;
    const id = `20000000-0000-4000-8000-${String(this.sequence).padStart(12, "0")}`;
    const now = new Date(this.sequence);
    const message: MessageServiceRecord = {
      id,
      conversationId: input.conversationId,
      whatsappMessageId: null,
      clientRequestId: input.clientRequestId,
      direction: MessageDirection.OUTBOUND,
      type: input.type,
      body: input.body,
      mediaObjectId: null,
      sentByUserId: input.sentByUserId,
      sentByUser: { id: input.sentByUserId, name: actor.name },
      status: MessageStatus.PENDING,
      failureReason: null,
      externalTimestamp: now,
      createdAt: now,
      contactPhone: "5561999999999",
      mediaObject: null,
    };
    this.records.set(id, message);
    this.clientIds.set(input.clientRequestId, id);
    this.history.push(`create:${message.status}`);
    return { message, created: true };
  }

  async attachStoredMedia(messageId: string, input: StoredMessageMediaInput) {
    const current = this.records.get(messageId)!;
    const updated: MessageServiceRecord = {
      ...current,
      mediaObjectId: `30000000-0000-4000-8000-${String(this.sequence).padStart(12, "0")}`,
      mediaObject: {
        id: `30000000-0000-4000-8000-${String(this.sequence).padStart(12, "0")}`,
        storageKey: input.storageKey,
        originalFilename: input.originalFilename,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        sha256: input.sha256,
        metaMediaId: null,
      },
    };
    this.records.set(messageId, updated);
    this.history.push("attach-media");
    return updated;
  }

  async setMediaMetaId(messageId: string, metaMediaId: string) {
    const current = this.records.get(messageId)!;
    const updated = { ...current, mediaObject: { ...current.mediaObject!, metaMediaId } };
    this.records.set(messageId, updated);
    return updated;
  }

  async markSent(messageId: string, whatsappMessageId: string) {
    const current = this.records.get(messageId)!;
    const updated = { ...current, whatsappMessageId, status: MessageStatus.SENT, failureReason: null };
    this.records.set(messageId, updated);
    this.history.push("commit:SENT");
    return updated;
  }

  async markFailed(messageId: string, failureReason: string) {
    const current = this.records.get(messageId)!;
    const updated = { ...current, status: MessageStatus.FAILED, failureReason };
    this.records.set(messageId, updated);
    this.history.push("commit:FAILED");
    return updated;
  }

  async findById(messageId: string) {
    return this.records.get(messageId) ?? null;
  }

  async claimFailedForRetry(messageId: string) {
    const current = this.records.get(messageId);
    if (!current || current.status !== MessageStatus.FAILED || current.direction !== MessageDirection.OUTBOUND) {
      return null;
    }
    const updated = { ...current, status: MessageStatus.PENDING, failureReason: null };
    this.records.set(messageId, updated);
    this.history.push("commit:PENDING-retry");
    return updated;
  }
}

class MemoryStorage implements MediaStorage {
  readonly files = new Map<string, Uint8Array>();
  private sequence = 0;

  async put(input: { bytes: Uint8Array }) {
    const key = `2026/08/123e4567-e89b-42d3-a456-${String(++this.sequence).padStart(12, "0")}`;
    this.files.set(key, Uint8Array.from(input.bytes));
    return { key, sizeBytes: BigInt(input.bytes.byteLength), sha256: "a".repeat(64) };
  }

  async open(key: string) {
    const bytes = this.files.get(key)!;
    return new ReadableStream<Uint8Array>({ start: (controller) => { controller.enqueue(bytes); controller.close(); } });
  }
}

class FakeProvider implements WhatsAppProvider {
  calls: string[] = [];
  failWith: Error | null = null;
  onCall?: () => void;

  private result() {
    this.onCall?.();
    if (this.failWith) throw this.failWith;
    return { whatsappMessageId: `wamid.${this.calls.length}`, status: "SENT" as const };
  }

  async sendText() {
    this.calls.push("text");
    return this.result();
  }

  async uploadMedia() {
    this.calls.push("upload");
    this.onCall?.();
    if (this.failWith) throw this.failWith;
    return { mediaId: `meta-${this.calls.length}` };
  }

  async sendMedia(input: { type: string }) {
    this.calls.push(input.type);
    return this.result();
  }

  async getMediaMetadata(): Promise<never> { throw new Error("unused"); }
  async downloadMedia(): Promise<never> { throw new Error("unused"); }
}

function harness() {
  const repository = new MemoryRepository();
  const storage = new MemoryStorage();
  const provider = new FakeProvider();
  const published: string[] = [];
  const dependencies: MessageServiceDependencies = {
    repository,
    storage,
    provider,
    limiter: new MessageSendRateLimiter(),
    publishRealtime: (event) => {
      repository.history.push(`publish:${event.type}`);
      published.push(event.type);
    },
  };
  return { dependencies, repository, storage, provider, published };
}

describe("outbound message service", () => {
  it("commits PENDING and publishes it before calling the provider, then commits SENT", async () => {
    const state = harness();
    state.provider.onCall = () => {
      const record = [...state.repository.records.values()][0]!;
      expect(record.status).toBe(MessageStatus.PENDING);
    };

    const result = await sendMessage(actor, conversationId, {
      type: MessageType.TEXT,
      clientRequestId: randomUUID(),
      body: "Olá",
    }, state.dependencies);

    expect(result.status).toBe(MessageStatus.SENT);
    expect(state.repository.history).toEqual([
      "create:PENDING",
      "publish:message.created",
      "commit:SENT",
      "publish:message.status",
    ]);
  });

  it("makes concurrent calls with the same clientRequestId idempotent", async () => {
    const state = harness();
    const clientRequestId = randomUUID();

    const results = await Promise.all([
      sendMessage(actor, conversationId, { type: MessageType.TEXT, clientRequestId, body: "uma" }, state.dependencies),
      sendMessage(actor, conversationId, { type: MessageType.TEXT, clientRequestId, body: "uma" }, state.dependencies),
    ]);

    expect(results[0]!.id).toBe(results[1]!.id);
    expect(state.repository.records).toHaveLength(1);
    expect(state.provider.calls).toEqual(["text"]);
    expect(state.published).toEqual(["message.created", "message.status"]);
  });

  it("commits a safe FAILED reason when the provider rejects", async () => {
    const state = harness();
    state.provider.failWith = new Error("secret-token-marker");

    const result = await sendMessage(actor, conversationId, {
      type: MessageType.TEXT,
      clientRequestId: randomUUID(),
      body: "Olá",
    }, state.dependencies);

    expect(result.status).toBe(MessageStatus.FAILED);
    expect(result.failureReason).toBe("Falha ao enviar mensagem");
    expect(result.failureReason).not.toContain("secret-token-marker");
    expect(state.published).toEqual(["message.created", "message.status"]);
  });

  it.each([
    [MessageType.IMAGE, "image/jpeg", "foto.jpg", Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]), "image"],
    [MessageType.AUDIO, "audio/mpeg", "som.mp3", new TextEncoder().encode("ID3\u0004"), "audio"],
    [MessageType.VIDEO, "video/mp4", "video.mp4", new TextEncoder().encode("....ftypisom"), "video"],
    [MessageType.DOCUMENT, "application/pdf", "nota.pdf", new TextEncoder().encode("%PDF-1.7"), "document"],
  ])("stores, uploads and sends %s", async (type, mimeType, filename, bytes, providerType) => {
    const state = harness();
    const result = await sendMessage(actor, conversationId, {
      type,
      clientRequestId: randomUUID(),
      body: "Legenda",
      file: { mimeType, filename, bytes },
    }, state.dependencies);

    expect(result.status).toBe(MessageStatus.SENT);
    expect(result.mediaObjectId).not.toBeNull();
    expect(state.provider.calls).toEqual(["upload", providerType]);
  });

  it("retries only a failed outbound record and never duplicates the UI message", async () => {
    const state = harness();
    state.provider.failWith = new Error("first failure");
    const failed = await sendMessage(actor, conversationId, {
      type: MessageType.TEXT,
      clientRequestId: randomUUID(),
      body: "Olá",
    }, state.dependencies);
    state.provider.failWith = null;

    const retries = await Promise.allSettled([
      retryMessage(actor, failed.id, state.dependencies),
      retryMessage(actor, failed.id, state.dependencies),
    ]);

    expect(retries.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(retries.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(state.repository.records).toHaveLength(1);
    expect(state.provider.calls).toEqual(["text", "text"]);
    expect(state.repository.records.get(failed.id)?.status).toBe(MessageStatus.SENT);
  });

  it("allows at most 30 provider attempts per active user per minute", async () => {
    const state = harness();
    const sends = Array.from({ length: 31 }, (_, index) =>
      sendMessage(actor, conversationId, {
        type: MessageType.TEXT,
        clientRequestId: randomUUID(),
        body: `Mensagem ${index}`,
      }, state.dependencies),
    );

    const results = await Promise.allSettled(sends);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(30);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(state.provider.calls).toHaveLength(30);
  });
});
