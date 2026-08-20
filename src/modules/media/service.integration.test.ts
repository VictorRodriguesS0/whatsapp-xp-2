// @vitest-environment node

import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MediaStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import type { MediaUploadSource, WhatsAppProvider } from "@/modules/whatsapp/provider";
import { WhatsAppProviderError } from "@/modules/whatsapp/meta-provider";
import { resetTestDatabase } from "@/test/database";
import { LocalMediaStorage } from "./local-storage";
import { ensureMediaAvailable, prismaMediaRepository, type MediaServiceDependencies } from "./service";

const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);
const sha = createHash("sha256").update(bytes).digest("base64");
const roots: string[] = [];

class Provider implements WhatsAppProvider {
  calls = 0;
  delayMs = 10;
  failure: Error | null = null;
  async getMediaMetadata(mediaId: string) {
    this.calls += 1;
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    if (this.failure) throw this.failure;
    return { id: mediaId, url: "https://lookaside.fbsbx.com/file", mimeType: "image/jpeg", sha256: sha, sizeBytes: 4n };
  }
  async downloadMedia() {
    return { stream: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } }), mimeType: "image/jpeg", sizeBytes: 4n };
  }
  async sendText(): Promise<never> { throw new Error("unused"); }
  async uploadMedia(_input: MediaUploadSource): Promise<never> { throw new Error("unused"); }
  async sendMedia(): Promise<never> { throw new Error("unused"); }
}

beforeEach(resetTestDatabase);
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("received media PostgreSQL leases", () => {
  it("allows one claimant across independent workers and recovers an expired crash lease", async () => {
    const root = await mkdtemp(join(tmpdir(), "xp-media-pg-"));
    roots.push(root);
    const provider = new Provider();
    const media = await prisma.mediaObject.create({
      data: {
        storageProvider: "local", originalFilename: "foto.jpg", mimeType: "image/jpeg", sizeBytes: 0n,
        sha256: sha, metaMediaId: "meta-pg", status: MediaStatus.PENDING,
        downloadLeaseId: randomUUID(), downloadLeaseUntil: new Date(Date.now() - 1000),
      },
    });
    const common = { repository: prismaMediaRepository, storage: new LocalMediaStorage(root), provider, mediaRoot: root };
    const worker = (): MediaServiceDependencies => ({ ...common, inFlight: new Map() });

    await Promise.all([ensureMediaAvailable(media.id, worker()), ensureMediaAvailable(media.id, worker())]);

    expect(provider.calls).toBe(1);
    await expect(prisma.mediaObject.findUnique({ where: { id: media.id }, select: { status: true, downloadAttempts: true, downloadLeaseId: true } }))
      .resolves.toEqual({ status: MediaStatus.AVAILABLE, downloadAttempts: 1, downloadLeaseId: null });
  });

  it("renews a PostgreSQL lease during a slow provider download", async () => {
    const root = await mkdtemp(join(tmpdir(), "xp-media-pg-slow-"));
    roots.push(root);
    const provider = new Provider();
    provider.delayMs = 120;
    const media = await prisma.mediaObject.create({
      data: {
        storageProvider: "local", originalFilename: "foto.jpg", mimeType: "image/jpeg", sizeBytes: 0n,
        sha256: sha, metaMediaId: "meta-pg-slow", status: MediaStatus.PENDING,
      },
    });
    const common = {
      repository: prismaMediaRepository,
      storage: new LocalMediaStorage(root),
      provider,
      mediaRoot: root,
      leaseMs: 30,
      leaseRenewIntervalMs: 10,
    };
    const worker = (): MediaServiceDependencies => ({ ...common, inFlight: new Map() });

    const first = ensureMediaAvailable(media.id, worker());
    while (!(await prisma.mediaObject.findUnique({ where: { id: media.id }, select: { downloadLeaseId: true } }))?.downloadLeaseId) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    await new Promise((resolve) => setTimeout(resolve, 70));
    const second = ensureMediaAvailable(media.id, worker());
    await Promise.all([first, second]);

    expect(provider.calls).toBe(1);
    await expect(prisma.mediaObject.findUnique({ where: { id: media.id }, select: { status: true, downloadAttempts: true } }))
      .resolves.toEqual({ status: MediaStatus.AVAILABLE, downloadAttempts: 1 });
  });

  it("atomically finalizes an expired fifth-attempt crash without another network call", async () => {
    const root = await mkdtemp(join(tmpdir(), "xp-media-pg-cap-"));
    roots.push(root);
    const provider = new Provider();
    const media = await prisma.mediaObject.create({
      data: {
        storageProvider: "local", originalFilename: "foto.jpg", mimeType: "image/jpeg", sizeBytes: 0n,
        sha256: sha, metaMediaId: "meta-pg-cap", status: MediaStatus.PENDING, downloadAttempts: 5,
        downloadLeaseId: randomUUID(), downloadLeaseUntil: new Date(Date.now() - 1_000),
      },
    });
    const dependencies: MediaServiceDependencies = {
      repository: prismaMediaRepository, storage: new LocalMediaStorage(root), provider, mediaRoot: root, inFlight: new Map(),
    };

    await ensureMediaAvailable(media.id, dependencies);

    expect(provider.calls).toBe(0);
    await expect(prisma.mediaObject.findUnique({ where: { id: media.id }, select: { status: true, failureReason: true, downloadLeaseId: true } }))
      .resolves.toEqual({ status: MediaStatus.FAILED, failureReason: "Falha ao obter mídia; intervenção necessária", downloadLeaseId: null });
  });

  it("recovers after fifth-attempt failure finalization itself loses the database", async () => {
    const root = await mkdtemp(join(tmpdir(), "xp-media-pg-cap-failure-"));
    roots.push(root);
    const provider = new Provider();
    provider.failure = new WhatsAppProviderError("unknown");
    const media = await prisma.mediaObject.create({
      data: {
        storageProvider: "local", originalFilename: "foto.jpg", mimeType: "image/jpeg", sizeBytes: 0n,
        sha256: sha, metaMediaId: "meta-pg-cap-failure", status: MediaStatus.PENDING, downloadAttempts: 4,
      },
    });
    const failingRepository = {
      ...prismaMediaRepository,
      async markPermanentFailure() { throw new Error("database unavailable"); },
    };

    await expect(ensureMediaAvailable(media.id, {
      repository: failingRepository, storage: new LocalMediaStorage(root), provider, mediaRoot: root, inFlight: new Map(),
    })).rejects.toThrow("database unavailable");
    await prisma.mediaObject.update({ where: { id: media.id }, data: { downloadLeaseUntil: new Date(Date.now() - 1_000) } });
    await ensureMediaAvailable(media.id, {
      repository: prismaMediaRepository, storage: new LocalMediaStorage(root), provider, mediaRoot: root, inFlight: new Map(),
    });

    expect(provider.calls).toBe(1);
    await expect(prisma.mediaObject.findUnique({ where: { id: media.id }, select: { status: true, downloadAttempts: true } }))
      .resolves.toEqual({ status: MediaStatus.FAILED, downloadAttempts: 5 });
  });
});
