// @vitest-environment node

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { MediaStatus } from "@/generated/prisma/enums";
import type { MediaStorage } from "./storage";
import type { WhatsAppProvider } from "@/modules/whatsapp/provider";

import {
  ensureMediaAvailable,
  getMediaForDownload,
  type MediaObjectRecord,
  type MediaServiceDependencies,
  type MediaServiceRepository,
} from "./service";

const mediaId = "30000000-0000-4000-8000-000000000001";
const actorId = "00000000-0000-4000-8000-000000000001";
const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);
const sha256Base64 = createHash("sha256").update(bytes).digest("base64");

class MemoryMediaRepository implements MediaServiceRepository {
  record: MediaObjectRecord = {
    id: mediaId,
    storageKey: null,
    originalFilename: "foto.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 0n,
    sha256: sha256Base64,
    metaMediaId: "meta-1",
    status: MediaStatus.PENDING,
    failureReason: null,
    linkedToMessage: true,
  };

  async findById(id: string) { return id === this.record.id ? this.record : null; }
  async findVisibleById(id: string, _actorId: string) {
    return id === this.record.id && this.record.linkedToMessage ? this.record : null;
  }
  async markAvailable(id: string, input: { storageKey: string; sizeBytes: bigint; sha256: string; mimeType: string }) {
    if (id !== this.record.id || this.record.status !== MediaStatus.PENDING) return false;
    this.record = { ...this.record, ...input, status: MediaStatus.AVAILABLE, failureReason: null };
    return true;
  }
  async markFailed(id: string, reason: string) {
    if (id === this.record.id && this.record.status === MediaStatus.PENDING) {
      this.record = { ...this.record, status: MediaStatus.FAILED, failureReason: reason };
    }
  }
}

class MemoryMediaStorage implements MediaStorage {
  files = new Map<string, Uint8Array>();
  putCalls = 0;
  async put(input: { bytes: Uint8Array }) {
    this.putCalls += 1;
    const key = "2026/08/123e4567-e89b-42d3-a456-426614174000";
    this.files.set(key, Uint8Array.from(input.bytes));
    return { key, sizeBytes: BigInt(input.bytes.byteLength), sha256: createHash("sha256").update(input.bytes).digest("hex") };
  }
  async open(key: string) {
    const content = this.files.get(key)!;
    return new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(content); controller.close(); } });
  }
}

class InboundProvider implements WhatsAppProvider {
  metadataCalls = 0;
  downloadCalls = 0;
  mimeType = "image/jpeg";
  async getMediaMetadata() {
    this.metadataCalls += 1;
    return {
      id: "meta-1",
      url: "https://lookaside.fbsbx.com/file",
      mimeType: this.mimeType,
      sha256: sha256Base64,
      sizeBytes: BigInt(bytes.byteLength),
    };
  }
  async downloadMedia() {
    this.downloadCalls += 1;
    await Promise.resolve();
    return { bytes, mimeType: this.mimeType };
  }
  async sendText(): Promise<never> { throw new Error("unused"); }
  async uploadMedia(): Promise<never> { throw new Error("unused"); }
  async sendMedia(): Promise<never> { throw new Error("unused"); }
}

function harness() {
  const repository = new MemoryMediaRepository();
  const storage = new MemoryMediaStorage();
  const provider = new InboundProvider();
  const dependencies: MediaServiceDependencies = {
    repository,
    storage,
    provider,
    inFlight: new Map(),
  };
  return { dependencies, repository, storage, provider };
}

describe("received media service", () => {
  it("downloads a pending Meta object once, validates it and marks it AVAILABLE", async () => {
    const state = harness();

    await Promise.all([
      ensureMediaAvailable(mediaId, state.dependencies),
      ensureMediaAvailable(mediaId, state.dependencies),
    ]);

    expect(state.provider.metadataCalls).toBe(1);
    expect(state.provider.downloadCalls).toBe(1);
    expect(state.storage.putCalls).toBe(1);
    expect(state.repository.record).toMatchObject({
      status: MediaStatus.AVAILABLE,
      sizeBytes: 4n,
      mimeType: "image/jpeg",
    });
  });

  it("fails closed when Graph metadata MIME differs from the signed webhook declaration", async () => {
    const state = harness();
    state.provider.mimeType = "image/png";

    await expect(ensureMediaAvailable(mediaId, state.dependencies)).rejects.toThrow();

    expect(state.provider.downloadCalls).toBe(0);
    expect(state.repository.record.status).toBe(MediaStatus.FAILED);
    expect(state.repository.record.failureReason).toBe("Falha ao obter mídia");
  });

  it("serves only media linked to a visible message and performs the PENDING fallback", async () => {
    const state = harness();

    const downloadable = await getMediaForDownload(actorId, mediaId, state.dependencies);
    const result = new Uint8Array(await new Response(downloadable.stream).arrayBuffer());

    expect(result).toEqual(bytes);
    expect(downloadable).toMatchObject({ mimeType: "image/jpeg", sizeBytes: 4n, filename: "foto.jpg" });

    state.repository.record = { ...state.repository.record, linkedToMessage: false };
    await expect(getMediaForDownload(actorId, mediaId, state.dependencies)).rejects.toMatchObject({ status: 404 });
  });
});
