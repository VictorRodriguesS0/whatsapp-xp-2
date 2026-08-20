// @vitest-environment node

import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  MessageDirection,
  MessageOperationalState,
  MessageStatus,
  MessageType,
  UserRole,
} from "@/generated/prisma/enums";
import type { MediaStorage } from "@/modules/media/storage";
import type { SessionUser } from "@/modules/auth/session";
import type { WhatsAppProvider } from "@/modules/whatsapp/provider";
import { WhatsAppProviderError } from "@/modules/whatsapp/meta-provider";

import {
  MessageSendRateLimiter,
  ProviderConcurrencyLimiter,
  retryMessage,
  sendMessage,
  type MessageServiceDependencies,
  type MessageServiceRecord,
  type MessageServiceRepository,
  type MessageRateLimitReservation,
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

function minimalVideoMp4(): Uint8Array {
  const box = (type: string, payload: Uint8Array) => {
    const bytes = new Uint8Array(8 + payload.byteLength);
    new DataView(bytes.buffer).setUint32(0, bytes.byteLength);
    bytes.set(new TextEncoder().encode(type), 4); bytes.set(payload, 8);
    return bytes;
  };
  const ftyp = box("ftyp", new TextEncoder().encode("isom\0\0\0\0isom"));
  const hdlr = new Uint8Array(12); hdlr.set(new TextEncoder().encode("vide"), 8);
  const moov = box("moov", box("trak", box("mdia", box("hdlr", hdlr))));
  const result = new Uint8Array(ftyp.length + moov.length); result.set(ftyp); result.set(moov, ftyp.length);
  return result;
}

class MemoryRepository implements MessageServiceRepository {
  readonly records = new Map<string, MessageServiceRecord>();
  readonly clientIds = new Map<string, string>();
  readonly history: string[] = [];
  private sequence = 0;
  failMarkSent = false;
  failAttach = false;
  failMarkOperationOnce = false;

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
      operationalState: MessageOperationalState.READY,
      providerAttemptedAt: null,
      deliveryLeaseId: null,
      deliveryLeaseUntil: null,
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
    if (this.failAttach) return "NO_COMMIT" as const;
    const current = this.records.get(messageId)!;
    if (current.mediaObjectId) return "CAS_LOST" as const;
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
      status: MessageStatus.PENDING,
      failureReason: null,
      operationalState: MessageOperationalState.READY,
    };
    this.records.set(messageId, updated);
    this.history.push("attach-media");
    return "ATTACHED" as const;
  }

  async setMediaMetaId(messageId: string, metaMediaId: string) {
    const current = this.records.get(messageId)!;
    const updated = { ...current, mediaObject: { ...current.mediaObject!, metaMediaId } };
    this.records.set(messageId, updated);
    return updated;
  }

  async markSent(messageId: string, whatsappMessageId: string) {
    if (this.failMarkSent) throw new Error("database unavailable");
    const current = this.records.get(messageId)!;
    const updated = { ...current, whatsappMessageId, status: MessageStatus.SENT, failureReason: null, operationalState: MessageOperationalState.SENT, deliveryLeaseId: null, deliveryLeaseUntil: null };
    this.records.set(messageId, updated);
    this.history.push("commit:SENT");
    return updated;
  }

  async markFailed(messageId: string, failureReason: string, operationalState: MessageOperationalState = MessageOperationalState.REJECTED) {
    const current = this.records.get(messageId)!;
    const updated = { ...current, status: MessageStatus.FAILED, failureReason, operationalState, deliveryLeaseId: null, deliveryLeaseUntil: null };
    this.records.set(messageId, updated);
    this.history.push("commit:FAILED");
    return updated;
  }

  async findById(messageId: string) {
    return this.records.get(messageId) ?? null;
  }

  async markOperation(messageId: string, operationalState: MessageOperationalState, attemptedAt: Date | null = null) {
    if (this.failMarkOperationOnce) {
      this.failMarkOperationOnce = false;
      throw new Error("database unavailable before provider");
    }
    const current = this.records.get(messageId)!;
    const updated = { ...current, operationalState, providerAttemptedAt: attemptedAt ?? current.providerAttemptedAt };
    this.records.set(messageId, updated);
    this.history.push(`operation:${operationalState}`);
    return updated;
  }

  async claimReadyForDelivery(messageId: string, input: { leaseId: string; now: Date; leaseUntil: Date }) {
    const current = this.records.get(messageId);
    if (!current || current.status !== MessageStatus.PENDING || current.operationalState !== MessageOperationalState.READY ||
      (current.deliveryLeaseUntil && current.deliveryLeaseUntil > input.now)) return null;
    const updated = { ...current, deliveryLeaseId: input.leaseId, deliveryLeaseUntil: input.leaseUntil };
    this.records.set(messageId, updated);
    return updated;
  }

  async releaseDeliveryClaim(messageId: string, leaseId: string) {
    const current = this.records.get(messageId);
    if (current?.deliveryLeaseId === leaseId && current.operationalState === MessageOperationalState.READY) {
      this.records.set(messageId, { ...current, deliveryLeaseId: null, deliveryLeaseUntil: null });
    }
  }

  async markProviderAttempt(messageId: string, leaseId: string, operationalState: MessageOperationalState, attemptedAt: Date) {
    const current = this.records.get(messageId);
    if (!current || current.deliveryLeaseId !== leaseId || current.operationalState !== MessageOperationalState.READY) return "CAS_LOST" as const;
    const marked = await this.markOperation(messageId, operationalState, attemptedAt);
    const updated = { ...marked, deliveryLeaseId: null, deliveryLeaseUntil: null };
    this.records.set(messageId, updated);
    return "MARKED" as const;
  }

  async claimFailedForRetry(messageId: string) {
    const current = this.records.get(messageId);
    if (!current || current.status !== MessageStatus.FAILED || current.direction !== MessageDirection.OUTBOUND) {
      return null;
    }
    const updated = { ...current, status: MessageStatus.PENDING, failureReason: null, operationalState: MessageOperationalState.READY, deliveryLeaseId: null, deliveryLeaseUntil: null };
    this.records.set(messageId, updated);
    this.history.push("commit:PENDING-retry");
    return updated;
  }
}

class MemoryStorage implements MediaStorage {
  readonly files = new Map<string, Uint8Array>();
  private sequence = 0;
  removeCalls = 0;

  async put(input: { bytes: Uint8Array }) {
    const key = `2026/08/123e4567-e89b-42d3-a456-${String(++this.sequence).padStart(12, "0")}`;
    this.files.set(key, Uint8Array.from(input.bytes));
    return { key, sizeBytes: BigInt(input.bytes.byteLength), sha256: createHash("sha256").update(input.bytes).digest("hex") };
  }

  async putStream(input: { stream: ReadableStream<Uint8Array>; maximumBytes: number }) {
    const bytes = new Uint8Array(await new Response(input.stream).arrayBuffer());
    if (bytes.byteLength > input.maximumBytes) throw new Error("limit");
    return this.put({ bytes });
  }

  async open(key: string) {
    const bytes = this.files.get(key)!;
    return new ReadableStream<Uint8Array>({ start: (controller) => { controller.enqueue(bytes); controller.close(); } });
  }

  async remove(key: string) { this.removeCalls += 1; this.files.delete(key); }
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

class CountingLimiter extends MessageSendRateLimiter {
  calls = 0;
  refunds = 0;
  override consume(userId: string, now?: Date): MessageRateLimitReservation | null {
    this.calls += 1;
    return super.consume(userId, now);
  }
  refund(reservation: MessageRateLimitReservation): void {
    this.refunds += 1;
    super.refund(reservation);
  }
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
  it("refunds only the exact concurrent rate-limit reservation once", async () => {
    const limiter = new MessageSendRateLimiter();
    const now = new Date("2026-08-20T12:00:00.000Z");
    const [first, second] = await Promise.all([
      Promise.resolve(limiter.consume(actor.id, now)),
      Promise.resolve(limiter.consume(actor.id, now)),
    ]);
    expect(first).toEqual(expect.objectContaining({ userId: actor.id }));
    expect(second).toEqual(expect.objectContaining({ userId: actor.id }));
    limiter.refund(first!);
    limiter.refund(first!);
    for (let index = 0; index < 29; index += 1) expect(limiter.consume(actor.id, now)).not.toBeNull();
    expect(limiter.consume(actor.id, now)).toBeNull();
  });
  it("bounds provider concurrency independently per authenticated user", async () => {
    const limiter = new ProviderConcurrencyLimiter(2);
    let active = 0;
    let maximum = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tasks = Array.from({ length: 4 }, () => limiter.run(actor.id, async () => {
      active += 1; maximum = Math.max(maximum, active);
      await gate;
      active -= 1;
    }));
    await new Promise((resolve) => setImmediate(resolve));
    expect(maximum).toBe(2);
    release();
    await Promise.all(tasks);
    expect(maximum).toBe(2);
  });
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
      "operation:SEND_IN_FLIGHT",
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
    state.provider.failWith = new WhatsAppProviderError("rejected", "secret-token-marker");

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

  it("keeps an unknown provider outcome PENDING and non-retryable", async () => {
    const state = harness();
    state.provider.failWith = new WhatsAppProviderError("unknown");
    const result = await sendMessage(actor, conversationId, { type: MessageType.TEXT, clientRequestId: randomUUID(), body: "Olá" }, state.dependencies);

    expect(result.status).toBe(MessageStatus.PENDING);
    expect(state.repository.records.get(result.id)?.operationalState).toBe(MessageOperationalState.OUTCOME_UNKNOWN);
    await expect(retryMessage(actor, result.id, state.dependencies)).rejects.toMatchObject({ status: 409 });
  });

  it("leaves the crash window PENDING when provider acceptance cannot be persisted", async () => {
    const state = harness();
    state.repository.failMarkSent = true;
    const result = await sendMessage(actor, conversationId, { type: MessageType.TEXT, clientRequestId: randomUUID(), body: "Olá" }, state.dependencies);

    expect(result.status).toBe(MessageStatus.PENDING);
    expect(state.repository.records.get(result.id)?.operationalState).toBe(MessageOperationalState.SEND_IN_FLIGHT);
    expect(state.provider.calls).toEqual(["text"]);
  });

  it("resumes the same READY record after a pre-provider database failure and refunds quota", async () => {
    const state = harness();
    const limiter = new CountingLimiter();
    state.dependencies.limiter = limiter;
    state.repository.failMarkOperationOnce = true;
    const clientRequestId = randomUUID();

    const first = await sendMessage(actor, conversationId, { type: MessageType.TEXT, clientRequestId, body: "Olá" }, state.dependencies);
    const resumed = await sendMessage(actor, conversationId, { type: MessageType.TEXT, clientRequestId, body: "Olá" }, state.dependencies);

    expect(first).toMatchObject({ status: MessageStatus.PENDING });
    expect(resumed).toMatchObject({ id: first.id, status: MessageStatus.SENT });
    expect(state.repository.records).toHaveLength(1);
    expect(state.provider.calls).toEqual(["text"]);
    expect(limiter.refunds).toBe(1);
  });

  it.each([
    [MessageType.IMAGE, "image/jpeg", "foto.jpg", Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]), "image"],
    [MessageType.AUDIO, "audio/mpeg", "som.mp3", new TextEncoder().encode("ID3\u0004"), "audio"],
    [MessageType.VIDEO, "video/mp4", "video.mp4", minimalVideoMp4(), "video"],
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
    const limiter = new CountingLimiter();
    state.dependencies.limiter = limiter;
    state.provider.failWith = new WhatsAppProviderError("rejected", "first failure");
    const failed = await sendMessage(actor, conversationId, {
      type: MessageType.TEXT,
      clientRequestId: randomUUID(),
      body: "Olá",
    }, state.dependencies);
    state.provider.failWith = null;
    limiter.calls = 0;

    const retries = await Promise.allSettled([
      retryMessage(actor, failed.id, state.dependencies),
      retryMessage(actor, failed.id, state.dependencies),
    ]);

    expect(retries.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(retries.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(state.repository.records).toHaveLength(1);
    expect(state.provider.calls).toEqual(["text", "text"]);
    expect(state.repository.records.get(failed.id)?.status).toBe(MessageStatus.SENT);
    expect(limiter.calls).toBe(1);
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

  it("cleans an orphaned file and makes an attach failure without media non-retryable", async () => {
    const state = harness();
    state.repository.failAttach = true;
    const failed = await sendMessage(actor, conversationId, {
      type: MessageType.IMAGE,
      clientRequestId: randomUUID(),
      file: { mimeType: "image/jpeg", filename: "x.jpg", bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]) },
    }, state.dependencies);

    expect(failed.status).toBe(MessageStatus.FAILED);
    expect(state.storage.removeCalls).toBe(1);
    await expect(retryMessage(actor, failed.id, state.dependencies)).rejects.toMatchObject({ status: 409 });
  });

  it("repairs LOCAL_FAILURE media through a new multipart payload with the same clientRequestId", async () => {
    const state = harness();
    const clientRequestId = randomUUID();
    const input = {
      type: MessageType.IMAGE,
      clientRequestId,
      file: { mimeType: "image/jpeg", filename: "x.jpg", bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]) },
    } as const;
    state.repository.failAttach = true;
    const failed = await sendMessage(actor, conversationId, input, state.dependencies);
    state.repository.failAttach = false;

    const [repaired, duplicate] = await Promise.all([
      sendMessage(actor, conversationId, input, state.dependencies),
      sendMessage(actor, conversationId, input, state.dependencies),
    ]);

    expect(failed).toMatchObject({ status: MessageStatus.FAILED, mediaObjectId: null });
    expect(repaired).toMatchObject({ id: failed.id, status: MessageStatus.SENT });
    expect(duplicate.id).toBe(failed.id);
    expect(state.repository.records).toHaveLength(1);
    expect(state.provider.calls).toEqual(["upload", "image"]);
    expect(state.storage.removeCalls).toBe(1);
  });

  it("does not delete repaired media when delivery is locally rate-limited", async () => {
    const state = harness();
    const clientRequestId = randomUUID();
    const input = {
      type: MessageType.IMAGE,
      clientRequestId,
      file: { mimeType: "image/jpeg", filename: "x.jpg", bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]) },
    } as const;
    state.repository.failAttach = true;
    const failed = await sendMessage(actor, conversationId, input, state.dependencies);
    state.repository.failAttach = false;
    state.dependencies.limiter = new class extends MessageSendRateLimiter { override consume() { return null; } }();

    await expect(sendMessage(actor, conversationId, input, state.dependencies)).rejects.toMatchObject({ status: 429 });

    expect(state.repository.records.get(failed.id)?.mediaObject).not.toBeNull();
    expect(state.storage.removeCalls).toBe(1);
  });
});
