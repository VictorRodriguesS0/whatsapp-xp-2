// @vitest-environment node

import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { MediaStatus } from "@/generated/prisma/enums";
import { WhatsAppProviderError } from "@/modules/whatsapp/meta-provider";
import type { MediaUploadSource, WhatsAppProvider } from "@/modules/whatsapp/provider";
import { LocalMediaStorage } from "./local-storage";
import { MediaTaskLimiter } from "./task-limiter";
import { ensureMediaAvailable, getMediaForDownload, recoverMedia, type MediaObjectRecord, type MediaServiceDependencies, type MediaServiceRepository } from "./service";

const mediaId = "30000000-0000-4000-8000-000000000001";
const actorId = "00000000-0000-4000-8000-000000000001";
const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);
const sha256Base64 = createHash("sha256").update(bytes).digest("base64");
const roots: string[] = [];

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

class MemoryMediaRepository implements MediaServiceRepository {
  actorActive = true;
  committed = false;
  realtimeTargetError: Error | null = null;
  record: MediaObjectRecord = {
    id: mediaId, storageKey: null, originalFilename: "foto.jpg", mimeType: "image/jpeg", sizeBytes: 0n,
    sha256: sha256Base64, metaMediaId: "meta-1", status: MediaStatus.PENDING, failureReason: null,
    terminalTransitionId: null,
    linkedToMessage: true, downloadLeaseId: null, downloadLeaseUntil: null, downloadNextAttemptAt: null, downloadAttempts: 0,
  };
  async findById(id: string) { return id === this.record.id ? this.record : null; }
  async findVisibleById(id: string, _actorId: string) { return id === this.record.id && this.record.linkedToMessage && this.actorActive ? this.record : null; }
  async resetFailed(id: string) {
    if (id !== this.record.id || this.record.status !== MediaStatus.FAILED) return false;
    this.record = {
      ...this.record,
      status: MediaStatus.PENDING,
      failureReason: null,
      terminalTransitionId: null,
      downloadLeaseId: null,
      downloadLeaseUntil: null,
      downloadNextAttemptAt: null,
      downloadAttempts: 0,
    };
    this.committed = true;
    return true;
  }
  async findRealtimeTarget(id: string) {
    if (this.realtimeTargetError) throw this.realtimeTargetError;
    return id === this.record.id && this.record.linkedToMessage
      ? { messageId: "20000000-0000-4000-8000-000000000001", conversationId: "10000000-0000-4000-8000-000000000001" }
      : null;
  }
  async claimPending(id: string, input: { leaseId: string; now: Date; leaseUntil: Date }) {
    if (id !== this.record.id || this.record.status !== MediaStatus.PENDING ||
      (this.record.downloadLeaseUntil && this.record.downloadLeaseUntil > input.now) ||
      (this.record.downloadNextAttemptAt && this.record.downloadNextAttemptAt > input.now)) return null;
    this.record = {
      ...this.record,
      terminalTransitionId: null,
      downloadLeaseId: input.leaseId,
      downloadLeaseUntil: input.leaseUntil,
      downloadAttempts: this.record.downloadAttempts + 1,
    };
    return this.record;
  }
  async finalizeExhausted(id: string, now: Date, reason: string, transitionId: string) {
    if (id !== this.record.id || this.record.status !== MediaStatus.PENDING || this.record.downloadAttempts < 5 ||
      (this.record.downloadLeaseUntil && this.record.downloadLeaseUntil > now)) return false;
    this.record = {
      ...this.record,
      status: MediaStatus.FAILED,
      failureReason: reason,
      terminalTransitionId: transitionId,
      downloadLeaseId: null,
      downloadLeaseUntil: null,
      downloadNextAttemptAt: null,
    };
    this.committed = true;
    return true;
  }
  async markAvailable(id: string, leaseId: string, input: { storageKey: string; sizeBytes: bigint; sha256: string; mimeType: string }) {
    if (id !== this.record.id || this.record.downloadLeaseId !== leaseId || this.record.status !== MediaStatus.PENDING) return false;
    this.record = {
      ...this.record,
      ...input,
      status: MediaStatus.AVAILABLE,
      failureReason: null,
      terminalTransitionId: null,
      downloadLeaseId: null,
      downloadLeaseUntil: null,
      downloadNextAttemptAt: null,
    };
    this.committed = true;
    return true;
  }
  async renewLease(id: string, leaseId: string, leaseUntil: Date) {
    if (id !== this.record.id || this.record.downloadLeaseId !== leaseId || this.record.status !== MediaStatus.PENDING) return false;
    this.record = { ...this.record, downloadLeaseUntil: leaseUntil };
    return true;
  }
  async markPermanentFailure(id: string, leaseId: string, reason: string, transitionId: string) {
    if (id === this.record.id && this.record.downloadLeaseId === leaseId && this.record.status === MediaStatus.PENDING) {
      this.record = {
        ...this.record,
        status: MediaStatus.FAILED,
        failureReason: reason,
        terminalTransitionId: transitionId,
        downloadLeaseId: null,
        downloadLeaseUntil: null,
      };
      this.committed = true;
      return true;
    }
    return false;
  }
  async releaseTransientFailure(id: string, leaseId: string, input: { reason: string; nextAttemptAt: Date }) {
    if (id === this.record.id && this.record.downloadLeaseId === leaseId && this.record.status === MediaStatus.PENDING)
      this.record = {
        ...this.record,
        failureReason: input.reason,
        terminalTransitionId: null,
        downloadNextAttemptAt: input.nextAttemptAt,
        downloadLeaseId: null,
        downloadLeaseUntil: null,
      };
  }
}

class InboundProvider implements WhatsAppProvider {
  metadataCalls = 0;
  downloadCalls = 0;
  mimeType = "image/jpeg";
  failure: WhatsAppProviderError | null = null;
  metadataGate: Promise<void> | null = null;
  async markRead(): Promise<void> {}
  async getMediaMetadata() {
    this.metadataCalls += 1;
    if (this.metadataGate) await this.metadataGate;
    if (this.failure) throw this.failure;
    return { id: "meta-1", url: "https://lookaside.fbsbx.com/file", mimeType: this.mimeType, sha256: sha256Base64, sizeBytes: BigInt(bytes.byteLength) };
  }
  async downloadMedia() {
    this.downloadCalls += 1;
    return { stream: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } }), mimeType: this.mimeType, sizeBytes: BigInt(bytes.byteLength) };
  }
  async sendText(): Promise<never> { throw new Error("unused"); }
  async sendReaction(): Promise<never> { throw new Error("unused"); }
  async uploadMedia(_input: MediaUploadSource): Promise<never> { throw new Error("unused"); }
  async sendMedia(): Promise<never> { throw new Error("unused"); }
}

async function harness() {
  const root = await mkdtemp(join(tmpdir(), "xp-inbound-"));
  roots.push(root);
  const repository = new MemoryMediaRepository();
  const storage = new LocalMediaStorage(root);
  const provider = new InboundProvider();
  let now = new Date("2026-08-20T12:00:00.000Z");
  const events: Array<{ type: string; conversationId: string; messageId: string; mediaId: string; afterCommit: boolean }> = [];
  const dependencies: MediaServiceDependencies = {
    repository,
    storage,
    provider,
    mediaRoot: root,
    inFlight: new Map(),
    now: () => now,
    createUuid: randomUUID,
    publishRealtime: (event) => events.push({ ...event, afterCommit: repository.committed }),
  };
  return { dependencies, repository, provider, events, advance(ms: number) { now = new Date(now.getTime() + ms); } };
}

describe("received media service", () => {
  it("downloads a pending Meta object once, validates it incrementally and marks it AVAILABLE", async () => {
    const state = await harness();
    await Promise.all([ensureMediaAvailable(mediaId, state.dependencies), ensureMediaAvailable(mediaId, state.dependencies)]);
    expect(state.provider.metadataCalls).toBe(1);
    expect(state.provider.downloadCalls).toBe(1);
    expect(state.repository.record).toMatchObject({ status: MediaStatus.AVAILABLE, sizeBytes: 4n, mimeType: "image/jpeg", downloadLeaseId: null });
  });

  it("accepts valid remote content when the provider filename has an incompatible extension", async () => {
    const state = await harness();
    state.repository.record = { ...state.repository.record, originalFilename: "provider-name.bin" };

    await ensureMediaAvailable(mediaId, state.dependencies);

    expect(state.repository.record).toMatchObject({
      status: MediaStatus.AVAILABLE,
      mimeType: "image/jpeg",
    });
  });

  it("canonicalizes parameterized Meta MIME metadata before compatibility checks", async () => {
    const state = await harness();
    state.repository.record = { ...state.repository.record, mimeType: "image/jpeg; profile=baseline" };
    state.provider.mimeType = "image/jpeg; profile=baseline";

    await ensureMediaAvailable(mediaId, state.dependencies);

    expect(state.repository.record).toMatchObject({
      status: MediaStatus.AVAILABLE,
      mimeType: "image/jpeg",
    });
  });

  it("marks a declared MIME mismatch as a permanent failure", async () => {
    const state = await harness();
    state.provider.mimeType = "image/png";
    await expect(ensureMediaAvailable(mediaId, state.dependencies)).rejects.toThrow();
    expect(state.provider.downloadCalls).toBe(0);
    expect(state.repository.record.status).toBe(MediaStatus.FAILED);
    expect(state.repository.record.failureReason).toBe("Mídia remota inválida");
  });

  it.each([
    ["MIME", "image/png", BigInt(bytes.byteLength)],
    ["declared size", "image/jpeg", BigInt(bytes.byteLength + 1)],
  ])("cancels the unconsumed provider stream once on incompatible %s", async (_case, mimeType, sizeBytes) => {
    const state = await harness();
    let cancelCalls = 0;
    state.provider.downloadMedia = async () => ({
      stream: new ReadableStream<Uint8Array>({
        cancel() { cancelCalls += 1; },
      }),
      mimeType,
      sizeBytes,
    });

    await expect(ensureMediaAvailable(mediaId, state.dependencies)).rejects.toThrow("Download remoto incompatível");
    await new Promise((resolve) => setImmediate(resolve));

    expect(cancelCalls).toBe(1);
  });

  it("cancels the provider stream once when staging fails before acquiring its reader", async () => {
    const state = await harness();
    const invalidRoot = join(state.dependencies.mediaRoot, "not-a-directory");
    await writeFile(invalidRoot, "blocking file");
    state.dependencies.mediaRoot = invalidRoot;
    let cancelCalls = 0;
    state.provider.downloadMedia = async () => ({
      stream: new ReadableStream<Uint8Array>({
        cancel() { cancelCalls += 1; },
      }),
      mimeType: "image/jpeg",
      sizeBytes: BigInt(bytes.byteLength),
    });

    await expect(ensureMediaAvailable(mediaId, state.dependencies)).rejects.toThrow();
    await new Promise((resolve) => setImmediate(resolve));

    expect(cancelCalls).toBe(1);
  });

  it("marks a definitive Meta rejection as permanent immediately", async () => {
    const state = await harness();
    state.provider.failure = new WhatsAppProviderError("rejected");

    await expect(ensureMediaAvailable(mediaId, state.dependencies)).rejects.toBeInstanceOf(WhatsAppProviderError);

    expect(state.repository.record).toMatchObject({ status: MediaStatus.FAILED, downloadAttempts: 1, downloadLeaseId: null });
    expect(state.repository.record.failureReason).not.toContain("Meta");
  });

  it("releases transient Meta failures back to PENDING with bounded backoff and retries later", async () => {
    const state = await harness();
    state.provider.failure = new WhatsAppProviderError("unknown");
    await expect(ensureMediaAvailable(mediaId, state.dependencies)).rejects.toBeInstanceOf(WhatsAppProviderError);
    expect(state.repository.record).toMatchObject({ status: MediaStatus.PENDING, downloadLeaseId: null, downloadAttempts: 1 });
    expect(state.repository.record.downloadNextAttemptAt).toEqual(new Date("2026-08-20T12:00:01.000Z"));
    await ensureMediaAvailable(mediaId, state.dependencies);
    expect(state.provider.metadataCalls).toBe(1);
    state.advance(1_000);
    state.provider.failure = null;
    await ensureMediaAvailable(mediaId, state.dependencies);
    expect(state.repository.record.status).toBe(MediaStatus.AVAILABLE);
  });

  it("returns a stable unavailable response for a transient GET fallback while leaving future recovery possible", async () => {
    const state = await harness();
    state.provider.failure = new WhatsAppProviderError("unknown");
    await expect(getMediaForDownload(actorId, mediaId, state.dependencies)).rejects.toMatchObject({ status: 424 });
    expect(state.repository.record.status).toBe(MediaStatus.PENDING);
    state.advance(1_000);
    state.provider.failure = null;
    const downloadable = await getMediaForDownload(actorId, mediaId, state.dependencies);
    expect(downloadable).toMatchObject({ mimeType: "image/jpeg" });
    await downloadable.stream.cancel();
  });

  it("stops transient retries after five attempts and requires intervention", async () => {
    const state = await harness();
    state.repository.record = { ...state.repository.record, downloadAttempts: 4 };
    state.provider.failure = new WhatsAppProviderError("unknown");

    await expect(ensureMediaAvailable(mediaId, state.dependencies)).rejects.toBeInstanceOf(WhatsAppProviderError);
    expect(state.repository.record).toMatchObject({ status: MediaStatus.FAILED, downloadAttempts: 5, downloadLeaseId: null });
    await ensureMediaAvailable(mediaId, state.dependencies).catch(() => undefined);
    expect(state.provider.metadataCalls).toBe(1);
  });

  it("finalizes an abandoned fifth attempt after its lease expires without another provider call", async () => {
    const state = await harness();
    state.repository.record = {
      ...state.repository.record,
      downloadAttempts: 5,
      downloadLeaseId: randomUUID(),
      downloadLeaseUntil: new Date("2026-08-20T11:59:59.000Z"),
    };

    await ensureMediaAvailable(mediaId, state.dependencies);

    expect(state.repository.record).toMatchObject({ status: MediaStatus.FAILED, downloadLeaseId: null });
    expect(state.provider.metadataCalls).toBe(0);
  });

  it("renews a slow download lease so an independent worker cannot duplicate provider work", async () => {
    const state = await harness();
    let release!: () => void;
    state.provider.metadataGate = new Promise<void>((resolve) => { release = resolve; });
    const worker = (): MediaServiceDependencies => ({
      ...state.dependencies,
      inFlight: new Map(),
      taskLimiter: new MediaTaskLimiter(4, 2),
      leaseMs: 100,
      leaseRenewIntervalMs: 10,
    });

    const first = ensureMediaAvailable(mediaId, worker());
    while (!state.repository.record.downloadLeaseId) await new Promise((resolve) => setImmediate(resolve));
    state.advance(3 * 60_000);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const second = ensureMediaAvailable(mediaId, worker());
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(state.provider.metadataCalls).toBe(1);
    release();
    await Promise.all([first, second]);
  });

  it("recovers an expired lease left by a crashed worker", async () => {
    const state = await harness();
    state.repository.record = { ...state.repository.record, downloadLeaseId: randomUUID(), downloadLeaseUntil: new Date("2026-08-20T11:59:59.000Z") };
    await ensureMediaAvailable(mediaId, state.dependencies);
    expect(state.repository.record.status).toBe(MediaStatus.AVAILABLE);
  });

  it("serves only media linked to a visible message and performs the PENDING fallback", async () => {
    const state = await harness();
    const downloadable = await getMediaForDownload(actorId, mediaId, state.dependencies);
    expect(new Uint8Array(await new Response(downloadable.stream).arrayBuffer())).toEqual(bytes);
    state.repository.record = { ...state.repository.record, linkedToMessage: false };
    await expect(getMediaForDownload(actorId, mediaId, state.dependencies)).rejects.toMatchObject({ status: 404 });
  });

  it("serves only the requested authorized byte range", async () => {
    const state = await harness();

    const downloadable = await getMediaForDownload(
      actorId,
      mediaId,
      state.dependencies,
      { rangeHeader: "bytes=1-2" },
    );

    expect(downloadable.range).toEqual({ start: 1n, end: 2n, length: 2n });
    expect([
      ...new Uint8Array(await new Response(downloadable.stream).arrayBuffer()),
    ]).toEqual([0xd8, 0xff]);
  });

  it.each(["bytes=4-", "bytes=2-1", "bytes=0-1,2-3"])(
    "rejects invalid byte range %s with a stable 416",
    async (rangeHeader) => {
      const state = await harness();
      await ensureMediaAvailable(mediaId, state.dependencies);

      await expect(getMediaForDownload(
        actorId,
        mediaId,
        state.dependencies,
        { rangeHeader },
      )).rejects.toMatchObject({
        status: 416,
        message: "Intervalo de mídia inválido",
        sizeBytes: 4n,
      });
    },
  );

  it("returns pending state without retrying before the bounded next-attempt time", async () => {
    const state = await harness();
    state.repository.record = {
      ...state.repository.record,
      downloadNextAttemptAt: new Date("2026-08-20T12:00:01.000Z"),
      downloadAttempts: 1,
    };

    await expect(recoverMedia(actorId, mediaId, false, state.dependencies)).resolves.toEqual({
      status: MediaStatus.PENDING,
      nextAttemptAt: "2026-08-20T12:00:01.000Z",
      canRetry: false,
    });
    expect(state.provider.metadataCalls).toBe(0);
    expect(state.events).toEqual([]);
  });

  it("returns only the safe next-claim time when another worker owns the lease", async () => {
    const state = await harness();
    state.repository.record = {
      ...state.repository.record,
      downloadLeaseId: randomUUID(),
      downloadLeaseUntil: new Date("2026-08-20T12:02:00.000Z"),
    };

    await expect(recoverMedia(actorId, mediaId, false, state.dependencies)).resolves.toEqual({
      status: MediaStatus.PENDING,
      nextAttemptAt: "2026-08-20T12:02:00.000Z",
      canRetry: false,
    });
    expect(state.provider.metadataCalls).toBe(0);
  });

  it("returns available state without another provider call", async () => {
    const state = await harness();
    state.repository.record = { ...state.repository.record, status: MediaStatus.AVAILABLE };

    await expect(recoverMedia(actorId, mediaId, false, state.dependencies)).resolves.toEqual({
      status: MediaStatus.AVAILABLE,
      nextAttemptAt: null,
      canRetry: false,
    });
    expect(state.provider.metadataCalls).toBe(0);
  });

  it("returns a bounded pending state after a transient provider failure", async () => {
    const state = await harness();
    state.provider.failure = new WhatsAppProviderError("unknown");

    await expect(recoverMedia(actorId, mediaId, false, state.dependencies)).resolves.toEqual({
      status: MediaStatus.PENDING,
      nextAttemptAt: "2026-08-20T12:00:01.000Z",
      canRetry: false,
    });
    expect(state.events).toEqual([]);
  });

  it("publishes exactly once and only after an exhausted failure commit", async () => {
    const state = await harness();
    state.repository.record = { ...state.repository.record, downloadAttempts: 4 };
    state.provider.failure = new WhatsAppProviderError("unknown");

    await expect(recoverMedia(actorId, mediaId, false, state.dependencies)).resolves.toEqual({
      status: MediaStatus.FAILED,
      nextAttemptAt: null,
      canRetry: true,
    });
    expect(state.events).toEqual([{
      type: "media.updated",
      conversationId: "10000000-0000-4000-8000-000000000001",
      messageId: "20000000-0000-4000-8000-000000000001",
      mediaId,
      afterCommit: true,
    }]);
  });

  it("atomically resets failed media before a manual bounded recovery", async () => {
    const state = await harness();
    state.repository.record = {
      ...state.repository.record,
      status: MediaStatus.FAILED,
      failureReason: "Falha ao obter mídia; intervenção necessária",
      downloadLeaseId: randomUUID(),
      downloadLeaseUntil: new Date("2026-08-20T13:00:00.000Z"),
      downloadNextAttemptAt: new Date("2026-08-20T13:00:00.000Z"),
      downloadAttempts: 5,
      terminalTransitionId: randomUUID(),
    };

    await expect(recoverMedia(actorId, mediaId, true, state.dependencies)).resolves.toEqual({
      status: MediaStatus.AVAILABLE,
      nextAttemptAt: null,
      canRetry: false,
    });
    expect(state.repository.record).toMatchObject({
      status: MediaStatus.AVAILABLE,
      failureReason: null,
      downloadLeaseId: null,
      downloadLeaseUntil: null,
      downloadNextAttemptAt: null,
      downloadAttempts: 1,
      terminalTransitionId: null,
    });
    expect(state.provider.downloadCalls).toBe(1);
  });

  it("coalesces simultaneous recoveries and emits one post-commit event", async () => {
    const state = await harness();

    const results = await Promise.all([
      recoverMedia(actorId, mediaId, false, state.dependencies),
      recoverMedia(actorId, mediaId, false, state.dependencies),
    ]);

    expect(results).toEqual([
      { status: MediaStatus.AVAILABLE, nextAttemptAt: null, canRetry: false },
      { status: MediaStatus.AVAILABLE, nextAttemptAt: null, canRetry: false },
    ]);
    expect(state.provider.downloadCalls).toBe(1);
    expect(state.events).toHaveLength(1);
    expect(state.events[0]).toMatchObject({ type: "media.updated", mediaId, afterCommit: true });
  });

  it("keeps committed media available when post-commit SSE target lookup fails", async () => {
    const state = await harness();
    state.repository.realtimeTargetError = new Error("realtime lookup unavailable");

    await expect(recoverMedia(actorId, mediaId, false, state.dependencies)).resolves.toEqual({
      status: MediaStatus.AVAILABLE,
      nextAttemptAt: null,
      canRetry: false,
    });
    expect(state.repository.record.status).toBe(MediaStatus.AVAILABLE);
    const downloadable = await getMediaForDownload(actorId, mediaId, state.dependencies);
    await expect(new Response(downloadable.stream).arrayBuffer()).resolves.toBeInstanceOf(ArrayBuffer);
  });

  it("removes its stored file when markAvailable fails before the PENDING commit", async () => {
    const state = await harness();
    let storedKey: string | undefined;
    state.repository.markAvailable = async (_id, _leaseId, input) => {
      storedKey = input.storageKey;
      throw new Error("database rejected before commit");
    };

    await expect(ensureMediaAvailable(mediaId, state.dependencies)).rejects.toThrow("database rejected before commit");

    expect(storedKey).toBeDefined();
    await expect(state.dependencies.storage.open(storedKey!)).rejects.toThrow();
    expect(state.repository.record).toMatchObject({
      status: MediaStatus.PENDING,
      downloadLeaseId: null,
      downloadNextAttemptAt: new Date("2026-08-20T12:00:01.000Z"),
    });
  });

  it("preserves its stored file when AVAILABLE commit reconciliation cannot query the database", async () => {
    const state = await harness();
    const markAvailable = state.repository.markAvailable.bind(state.repository);
    const findById = state.repository.findById.bind(state.repository);
    let reconciliationPending = false;
    let storedKey: string | undefined;
    state.repository.markAvailable = async (id, leaseId, input) => {
      storedKey = input.storageKey;
      await markAvailable(id, leaseId, input);
      reconciliationPending = true;
      throw new Error("database response lost after commit");
    };
    state.repository.findById = async (id) => {
      if (reconciliationPending) {
        reconciliationPending = false;
        throw new Error("database unavailable during reconciliation");
      }
      return findById(id);
    };

    await expect(ensureMediaAvailable(mediaId, state.dependencies)).rejects.toThrow("database response lost after commit");

    expect(state.repository.record.status).toBe(MediaStatus.AVAILABLE);
    const stream = await state.dependencies.storage.open(storedKey!);
    expect(new Uint8Array(await new Response(stream).arrayBuffer())).toEqual(bytes);
  });

  it("removes its unreferenced file after reconciling a competing AVAILABLE key", async () => {
    const state = await harness();
    let storedKey: string | undefined;
    state.repository.markAvailable = async (_id, _leaseId, input) => {
      storedKey = input.storageKey;
      state.repository.record = {
        ...state.repository.record,
        status: MediaStatus.AVAILABLE,
        storageKey: "different-worker-key",
        downloadLeaseId: null,
        downloadLeaseUntil: null,
      };
      throw new Error("database response lost to this worker");
    };

    await expect(ensureMediaAvailable(mediaId, state.dependencies)).rejects.toThrow("database response lost to this worker");

    expect(storedKey).toBeDefined();
    await expect(state.dependencies.storage.open(storedKey!)).rejects.toThrow();
    expect(state.repository.record).toMatchObject({
      status: MediaStatus.AVAILABLE,
      storageKey: "different-worker-key",
    });
  });

  it("does not wait forever for provider cancellation before stopping lease renewal", async () => {
    const state = await harness();
    const invalidRoot = join(state.dependencies.mediaRoot, "cancel-never-settles");
    await writeFile(invalidRoot, "blocking file");
    state.dependencies.mediaRoot = invalidRoot;
    state.dependencies.leaseMs = 20;
    state.dependencies.leaseRenewIntervalMs = 5;
    let cancelCalls = 0;
    let renewCalls = 0;
    const renewLease = state.repository.renewLease.bind(state.repository);
    state.repository.renewLease = async (...args) => {
      renewCalls += 1;
      return renewLease(...args);
    };
    state.provider.downloadMedia = async () => ({
      stream: new ReadableStream<Uint8Array>({
        cancel() {
          cancelCalls += 1;
          return new Promise<void>(() => undefined);
        },
      }),
      mimeType: "image/jpeg",
      sizeBytes: BigInt(bytes.byteLength),
    });

    let timeout: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      ensureMediaAvailable(mediaId, state.dependencies).then(
        () => "resolved",
        () => "rejected",
      ),
      new Promise<string>((resolve) => {
        timeout = setTimeout(() => resolve("timed-out"), 500);
      }),
    ]).finally(() => clearTimeout(timeout));

    expect(result).toBe("rejected");
    expect(cancelCalls).toBe(1);
    const callsAfterSettlement = renewCalls;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(renewCalls).toBe(callsAfterSettlement);
  });

  it("rejects recovery when the active actor cannot see a linked conversation", async () => {
    const state = await harness();
    state.repository.actorActive = false;

    await expect(recoverMedia(actorId, mediaId, false, state.dependencies)).rejects.toMatchObject({ status: 404 });
    expect(state.provider.metadataCalls).toBe(0);
    expect(state.events).toEqual([]);
  });
});
