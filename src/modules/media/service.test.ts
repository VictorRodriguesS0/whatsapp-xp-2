// @vitest-environment node

import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { MediaStatus } from "@/generated/prisma/enums";
import { WhatsAppProviderError } from "@/modules/whatsapp/meta-provider";
import type { MediaUploadSource, WhatsAppProvider } from "@/modules/whatsapp/provider";
import { LocalMediaStorage } from "./local-storage";
import { MediaTaskLimiter } from "./task-limiter";
import { ensureMediaAvailable, getMediaForDownload, type MediaObjectRecord, type MediaServiceDependencies, type MediaServiceRepository } from "./service";

const mediaId = "30000000-0000-4000-8000-000000000001";
const actorId = "00000000-0000-4000-8000-000000000001";
const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);
const sha256Base64 = createHash("sha256").update(bytes).digest("base64");
const roots: string[] = [];

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

class MemoryMediaRepository implements MediaServiceRepository {
  record: MediaObjectRecord = {
    id: mediaId, storageKey: null, originalFilename: "foto.jpg", mimeType: "image/jpeg", sizeBytes: 0n,
    sha256: sha256Base64, metaMediaId: "meta-1", status: MediaStatus.PENDING, failureReason: null,
    linkedToMessage: true, downloadLeaseId: null, downloadLeaseUntil: null, downloadNextAttemptAt: null, downloadAttempts: 0,
  };
  async findById(id: string) { return id === this.record.id ? this.record : null; }
  async findVisibleById(id: string, _actorId: string) { return id === this.record.id && this.record.linkedToMessage ? this.record : null; }
  async claimPending(id: string, input: { leaseId: string; now: Date; leaseUntil: Date }) {
    if (id !== this.record.id || this.record.status !== MediaStatus.PENDING ||
      (this.record.downloadLeaseUntil && this.record.downloadLeaseUntil > input.now) ||
      (this.record.downloadNextAttemptAt && this.record.downloadNextAttemptAt > input.now)) return null;
    this.record = { ...this.record, downloadLeaseId: input.leaseId, downloadLeaseUntil: input.leaseUntil, downloadAttempts: this.record.downloadAttempts + 1 };
    return this.record;
  }
  async finalizeExhausted(id: string, now: Date, reason: string) {
    if (id !== this.record.id || this.record.status !== MediaStatus.PENDING || this.record.downloadAttempts < 5 ||
      (this.record.downloadLeaseUntil && this.record.downloadLeaseUntil > now)) return false;
    this.record = { ...this.record, status: MediaStatus.FAILED, failureReason: reason, downloadLeaseId: null, downloadLeaseUntil: null, downloadNextAttemptAt: null };
    return true;
  }
  async markAvailable(id: string, leaseId: string, input: { storageKey: string; sizeBytes: bigint; sha256: string; mimeType: string }) {
    if (id !== this.record.id || this.record.downloadLeaseId !== leaseId || this.record.status !== MediaStatus.PENDING) return false;
    this.record = { ...this.record, ...input, status: MediaStatus.AVAILABLE, failureReason: null, downloadLeaseId: null, downloadLeaseUntil: null, downloadNextAttemptAt: null };
    return true;
  }
  async renewLease(id: string, leaseId: string, leaseUntil: Date) {
    if (id !== this.record.id || this.record.downloadLeaseId !== leaseId || this.record.status !== MediaStatus.PENDING) return false;
    this.record = { ...this.record, downloadLeaseUntil: leaseUntil };
    return true;
  }
  async markPermanentFailure(id: string, leaseId: string, reason: string) {
    if (id === this.record.id && this.record.downloadLeaseId === leaseId && this.record.status === MediaStatus.PENDING)
      this.record = { ...this.record, status: MediaStatus.FAILED, failureReason: reason, downloadLeaseId: null, downloadLeaseUntil: null };
  }
  async releaseTransientFailure(id: string, leaseId: string, input: { reason: string; nextAttemptAt: Date }) {
    if (id === this.record.id && this.record.downloadLeaseId === leaseId && this.record.status === MediaStatus.PENDING)
      this.record = { ...this.record, failureReason: input.reason, downloadNextAttemptAt: input.nextAttemptAt, downloadLeaseId: null, downloadLeaseUntil: null };
  }
}

class InboundProvider implements WhatsAppProvider {
  metadataCalls = 0;
  downloadCalls = 0;
  mimeType = "image/jpeg";
  failure: WhatsAppProviderError | null = null;
  metadataGate: Promise<void> | null = null;
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
  const dependencies: MediaServiceDependencies = { repository, storage, provider, mediaRoot: root, inFlight: new Map(), now: () => now, createUuid: randomUUID };
  return { dependencies, repository, provider, advance(ms: number) { now = new Date(now.getTime() + ms); } };
}

describe("received media service", () => {
  it("downloads a pending Meta object once, validates it incrementally and marks it AVAILABLE", async () => {
    const state = await harness();
    await Promise.all([ensureMediaAvailable(mediaId, state.dependencies), ensureMediaAvailable(mediaId, state.dependencies)]);
    expect(state.provider.metadataCalls).toBe(1);
    expect(state.provider.downloadCalls).toBe(1);
    expect(state.repository.record).toMatchObject({ status: MediaStatus.AVAILABLE, sizeBytes: 4n, mimeType: "image/jpeg", downloadLeaseId: null });
  });

  it("marks a declared MIME mismatch as a permanent failure", async () => {
    const state = await harness();
    state.provider.mimeType = "image/png";
    await expect(ensureMediaAvailable(mediaId, state.dependencies)).rejects.toThrow();
    expect(state.provider.downloadCalls).toBe(0);
    expect(state.repository.record.status).toBe(MediaStatus.FAILED);
    expect(state.repository.record.failureReason).toBe("Mídia remota inválida");
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
    await expect(getMediaForDownload(actorId, mediaId, state.dependencies)).resolves.toMatchObject({ mimeType: "image/jpeg" });
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
});
