// @vitest-environment node

import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MediaStatus, MessageDirection, MessageStatus, MessageType, UserRole } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import type { MediaUploadSource, WhatsAppProvider } from "@/modules/whatsapp/provider";
import { WhatsAppProviderError } from "@/modules/whatsapp/meta-provider";
import { resetTestDatabase } from "@/test/database";
import { LocalMediaStorage } from "./local-storage";
import { ensureMediaAvailable, prismaMediaRepository, recoverMedia, type MediaServiceDependencies } from "./service";

const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);
const sha = createHash("sha256").update(bytes).digest("base64");
const roots: string[] = [];

class Provider implements WhatsAppProvider {
  calls = 0;
  downloadCalls = 0;
  delayMs = 10;
  failure: Error | null = null;
  async markRead(): Promise<void> {}
  async getMediaMetadata(mediaId: string) {
    this.calls += 1;
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    if (this.failure) throw this.failure;
    return { id: mediaId, url: "https://lookaside.fbsbx.com/file", mimeType: "image/jpeg", sha256: sha, sizeBytes: 4n };
  }
  async downloadMedia() {
    this.downloadCalls += 1;
    return { stream: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } }), mimeType: "image/jpeg", sizeBytes: 4n };
  }
  async sendText(): Promise<never> { throw new Error("unused"); }
  async sendReaction(): Promise<never> { throw new Error("unused"); }
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

  it("reconciles a real AVAILABLE commit when the repository response is lost", async () => {
    const root = await mkdtemp(join(tmpdir(), "xp-media-pg-ambiguous-"));
    roots.push(root);
    const provider = new Provider();
    const storage = new LocalMediaStorage(root);
    const contact = await prisma.contact.create({
      data: { name: "Contato ambíguo", whatsappId: "5511999990011" },
    });
    const conversation = await prisma.conversation.create({
      data: { contactId: contact.id, lastMessageAt: new Date() },
    });
    const media = await prisma.mediaObject.create({
      data: {
        storageProvider: "local",
        originalFilename: "foto.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 0n,
        sha256: sha,
        metaMediaId: "meta-pg-ambiguous",
        status: MediaStatus.PENDING,
      },
    });
    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: MessageDirection.INBOUND,
        type: MessageType.IMAGE,
        mediaObjectId: media.id,
        status: MessageStatus.RECEIVED,
        externalTimestamp: new Date(),
      },
    });
    let committedBeforeFault = false;
    const faultingRepository = {
      ...prismaMediaRepository,
      async markAvailable(
        id: string,
        leaseId: string,
        input: Parameters<typeof prismaMediaRepository.markAvailable>[2],
      ) {
        committedBeforeFault = await prismaMediaRepository.markAvailable(id, leaseId, input);
        throw new Error("simulated database response loss after commit");
      },
    };
    const events: unknown[] = [];

    await expect(ensureMediaAvailable(media.id, {
      repository: faultingRepository,
      storage,
      provider,
      mediaRoot: root,
      inFlight: new Map(),
      publishRealtime: (event) => events.push(event),
    })).resolves.toBeUndefined();

    expect(committedBeforeFault).toBe(true);
    const persisted = await prisma.mediaObject.findUniqueOrThrow({
      where: { id: media.id },
      select: { status: true, storageKey: true },
    });
    expect(persisted.status).toBe(MediaStatus.AVAILABLE);
    expect(persisted.storageKey).not.toBeNull();
    const stream = await storage.open(persisted.storageKey!);
    expect(new Uint8Array(await new Response(stream).arrayBuffer())).toEqual(bytes);
    expect(events).toEqual([{
      type: "media.updated",
      conversationId: conversation.id,
      messageId: message.id,
      mediaId: media.id,
    }]);
  });

  it("reconciles a real finalizeExhausted commit after its response is lost and publishes once", async () => {
    const root = await mkdtemp(join(tmpdir(), "xp-media-pg-finalize-ambiguous-"));
    roots.push(root);
    const provider = new Provider();
    const contact = await prisma.contact.create({
      data: { name: "Contato finalização ambígua", whatsappId: "5511999990013" },
    });
    const conversation = await prisma.conversation.create({
      data: { contactId: contact.id, lastMessageAt: new Date() },
    });
    const media = await prisma.mediaObject.create({
      data: {
        storageProvider: "local",
        originalFilename: "foto.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 0n,
        sha256: sha,
        metaMediaId: "meta-pg-finalize-ambiguous",
        status: MediaStatus.PENDING,
        downloadAttempts: 5,
      },
    });
    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: MessageDirection.INBOUND,
        type: MessageType.IMAGE,
        mediaObjectId: media.id,
        status: MessageStatus.RECEIVED,
        externalTimestamp: new Date(),
      },
    });
    const transitionId = "60000000-0000-4000-8000-000000000001";
    let committedBeforeFault = false;
    const faultingRepository = {
      ...prismaMediaRepository,
      async finalizeExhausted(id: string, now: Date, reason: string, callerTransitionId: string) {
        committedBeforeFault = await prismaMediaRepository.finalizeExhausted(id, now, reason, callerTransitionId);
        throw new Error("simulated finalizeExhausted response loss after commit");
      },
    };
    const events: unknown[] = [];

    await expect(ensureMediaAvailable(media.id, {
      repository: faultingRepository,
      storage: new LocalMediaStorage(root),
      provider,
      mediaRoot: root,
      inFlight: new Map(),
      createUuid: () => transitionId,
      publishRealtime: (event) => events.push(event),
    })).resolves.toBeUndefined();

    expect(committedBeforeFault).toBe(true);
    expect(provider.calls).toBe(0);
    await expect(prisma.mediaObject.findUniqueOrThrow({
      where: { id: media.id },
      select: { status: true, failureReason: true },
    })).resolves.toEqual({
      status: MediaStatus.FAILED,
      failureReason: "Falha ao obter mídia; intervenção necessária",
    });
    expect(events).toEqual([{
      type: "media.updated",
      conversationId: conversation.id,
      messageId: message.id,
      mediaId: media.id,
    }]);
    const [ownership] = await prisma.$queryRaw<Array<{ terminal_transition_id: string | null }>>`
      SELECT terminal_transition_id::text
      FROM media_objects
      WHERE id = ${media.id}::uuid
    `;
    expect(ownership?.terminal_transition_id).toBe(transitionId);
  });

  it("reconciles a real markPermanentFailure commit after its response is lost and publishes once", async () => {
    const root = await mkdtemp(join(tmpdir(), "xp-media-pg-permanent-ambiguous-"));
    roots.push(root);
    const provider = new Provider();
    provider.failure = new WhatsAppProviderError("rejected", "definitive provider rejection");
    const contact = await prisma.contact.create({
      data: { name: "Contato falha ambígua", whatsappId: "5511999990014" },
    });
    const conversation = await prisma.conversation.create({
      data: { contactId: contact.id, lastMessageAt: new Date() },
    });
    const media = await prisma.mediaObject.create({
      data: {
        storageProvider: "local",
        originalFilename: "foto.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 0n,
        sha256: sha,
        metaMediaId: "meta-pg-permanent-ambiguous",
        status: MediaStatus.PENDING,
      },
    });
    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: MessageDirection.INBOUND,
        type: MessageType.IMAGE,
        mediaObjectId: media.id,
        status: MessageStatus.RECEIVED,
        externalTimestamp: new Date(),
      },
    });
    const transitionId = "60000000-0000-4000-8000-000000000002";
    let committedBeforeFault = false;
    const faultingRepository = {
      ...prismaMediaRepository,
      async markPermanentFailure(id: string, leaseId: string, reason: string, callerTransitionId: string) {
        committedBeforeFault = await prismaMediaRepository.markPermanentFailure(id, leaseId, reason, callerTransitionId);
        throw new Error("simulated markPermanentFailure response loss after commit");
      },
    };
    const events: unknown[] = [];

    await expect(ensureMediaAvailable(media.id, {
      repository: faultingRepository,
      storage: new LocalMediaStorage(root),
      provider,
      mediaRoot: root,
      inFlight: new Map(),
      createUuid: () => transitionId,
      publishRealtime: (event) => events.push(event),
    })).rejects.toBeInstanceOf(WhatsAppProviderError);

    expect(committedBeforeFault).toBe(true);
    await expect(prisma.mediaObject.findUniqueOrThrow({
      where: { id: media.id },
      select: { status: true, failureReason: true },
    })).resolves.toEqual({ status: MediaStatus.FAILED, failureReason: "Mídia remota inválida" });
    expect(events).toEqual([{
      type: "media.updated",
      conversationId: conversation.id,
      messageId: message.id,
      mediaId: media.id,
    }]);
    const [ownership] = await prisma.$queryRaw<Array<{ terminal_transition_id: string | null }>>`
      SELECT terminal_transition_id::text
      FROM media_objects
      WHERE id = ${media.id}::uuid
    `;
    expect(ownership?.terminal_transition_id).toBe(transitionId);
  });

  it("publishes only for the terminal CAS owner when a losing worker also loses its response", async () => {
    const root = await mkdtemp(join(tmpdir(), "xp-media-pg-terminal-owner-"));
    roots.push(root);
    const provider = new Provider();
    const contact = await prisma.contact.create({
      data: { name: "Contato autoria terminal", whatsappId: "5511999990015" },
    });
    const conversation = await prisma.conversation.create({
      data: { contactId: contact.id, lastMessageAt: new Date() },
    });
    const media = await prisma.mediaObject.create({
      data: {
        storageProvider: "local",
        originalFilename: "foto.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 0n,
        sha256: sha,
        metaMediaId: "meta-pg-terminal-owner",
        status: MediaStatus.PENDING,
        downloadAttempts: 5,
      },
    });
    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: MessageDirection.INBOUND,
        type: MessageType.IMAGE,
        mediaObjectId: media.id,
        status: MessageStatus.RECEIVED,
        externalTimestamp: new Date(),
      },
    });
    const winnerTransitionId = "60000000-0000-4000-8000-000000000003";
    const loserTransitionId = "60000000-0000-4000-8000-000000000004";
    let initialReads = 0;
    let releaseInitialReads!: () => void;
    const initialReadsComplete = new Promise<void>((resolve) => { releaseInitialReads = resolve; });
    let releaseWinnerCommit!: () => void;
    const winnerCommitComplete = new Promise<void>((resolve) => { releaseWinnerCommit = resolve; });

    const withInitialReadBarrier = () => {
      let initial = true;
      return {
        ...prismaMediaRepository,
        async findById(id: string) {
          const row = await prismaMediaRepository.findById(id);
          if (initial) {
            initial = false;
            initialReads += 1;
            if (initialReads === 2) releaseInitialReads();
            await initialReadsComplete;
          }
          return row;
        },
      };
    };
    const winnerBase = withInitialReadBarrier();
    const loserBase = withInitialReadBarrier();
    const winnerRepository = {
      ...winnerBase,
      async finalizeExhausted(id: string, now: Date, reason: string, transitionId: string) {
        const won = await prismaMediaRepository.finalizeExhausted(id, now, reason, transitionId);
        releaseWinnerCommit();
        return won;
      },
    };
    let loserCas: boolean | undefined;
    const loserRepository = {
      ...loserBase,
      async finalizeExhausted(id: string, now: Date, reason: string, transitionId: string) {
        await winnerCommitComplete;
        loserCas = await prismaMediaRepository.finalizeExhausted(id, now, reason, transitionId);
        throw new Error("simulated losing-worker response loss after CAS=0");
      },
    };
    const winnerEvents: unknown[] = [];
    const loserEvents: unknown[] = [];

    const outcomes = await Promise.allSettled([
      ensureMediaAvailable(media.id, {
        repository: winnerRepository,
        storage: new LocalMediaStorage(root),
        provider,
        mediaRoot: root,
        inFlight: new Map(),
        createUuid: () => winnerTransitionId,
        publishRealtime: (event) => winnerEvents.push(event),
      }),
      ensureMediaAvailable(media.id, {
        repository: loserRepository,
        storage: new LocalMediaStorage(root),
        provider,
        mediaRoot: root,
        inFlight: new Map(),
        createUuid: () => loserTransitionId,
        publishRealtime: (event) => loserEvents.push(event),
      }),
    ]);

    expect(outcomes[0].status).toBe("fulfilled");
    expect(outcomes[1]).toMatchObject({ status: "rejected", reason: new Error("simulated losing-worker response loss after CAS=0") });
    expect(loserCas).toBe(false);
    expect(winnerEvents).toEqual([{
      type: "media.updated",
      conversationId: conversation.id,
      messageId: message.id,
      mediaId: media.id,
    }]);
    expect(loserEvents).toEqual([]);
    const [ownership] = await prisma.$queryRaw<Array<{ terminal_transition_id: string | null }>>`
      SELECT terminal_transition_id::text
      FROM media_objects
      WHERE id = ${media.id}::uuid
    `;
    expect(ownership?.terminal_transition_id).toBe(winnerTransitionId);
  });

  it("atomically resets a visible failed object and coalesces simultaneous manual recoveries", async () => {
    const root = await mkdtemp(join(tmpdir(), "xp-media-pg-manual-"));
    roots.push(root);
    const provider = new Provider();
    provider.delayMs = 30;
    const user = await prisma.user.create({
      data: {
        name: "Victor",
        email: "victor.media-recovery@example.test",
        passwordHash: "not-used-by-this-fixture",
        role: UserRole.ADMIN,
      },
    });
    const contact = await prisma.contact.create({
      data: { name: "Contato", whatsappId: "5511999990010" },
    });
    const conversation = await prisma.conversation.create({
      data: { contactId: contact.id, lastMessageAt: new Date() },
    });
    const media = await prisma.mediaObject.create({
      data: {
        storageProvider: "local",
        originalFilename: "foto.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 0n,
        sha256: sha,
        metaMediaId: "meta-pg-manual",
        status: MediaStatus.FAILED,
        failureReason: "Falha ao obter mídia; intervenção necessária",
        downloadAttempts: 5,
        downloadLeaseId: randomUUID(),
        downloadLeaseUntil: new Date(Date.now() + 60_000),
        downloadNextAttemptAt: new Date(Date.now() + 60_000),
      },
    });
    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: MessageDirection.INBOUND,
        type: MessageType.IMAGE,
        mediaObjectId: media.id,
        status: MessageStatus.RECEIVED,
        externalTimestamp: new Date(),
      },
    });
    const events: unknown[] = [];
    const common = {
      repository: prismaMediaRepository,
      storage: new LocalMediaStorage(root),
      provider,
      mediaRoot: root,
      publishRealtime: (event: unknown) => events.push(event),
    };
    const worker = (): MediaServiceDependencies => ({ ...common, inFlight: new Map() });

    const states = await Promise.all([
      recoverMedia(user.id, media.id, true, worker()),
      recoverMedia(user.id, media.id, true, worker()),
    ]);

    expect(states.some((state) => state.status === MediaStatus.AVAILABLE)).toBe(true);
    expect(states.every((state) =>
      state.status === MediaStatus.PENDING || state.status === MediaStatus.AVAILABLE,
    )).toBe(true);
    expect(provider.downloadCalls).toBe(1);
    await expect(prisma.mediaObject.findUnique({
      where: { id: media.id },
      select: {
        status: true,
        failureReason: true,
        downloadAttempts: true,
        downloadLeaseId: true,
        downloadLeaseUntil: true,
        downloadNextAttemptAt: true,
      },
    })).resolves.toEqual({
      status: MediaStatus.AVAILABLE,
      failureReason: null,
      downloadAttempts: 1,
      downloadLeaseId: null,
      downloadLeaseUntil: null,
      downloadNextAttemptAt: null,
    });
    expect(events).toEqual([{
      type: "media.updated",
      conversationId: conversation.id,
      messageId: message.id,
      mediaId: media.id,
    }]);
  });

  it("rejects media visibility for an inactive actor without resetting or downloading", async () => {
    const root = await mkdtemp(join(tmpdir(), "xp-media-pg-inactive-"));
    roots.push(root);
    const provider = new Provider();
    const user = await prisma.user.create({
      data: {
        name: "Inativo",
        email: "inactive.media-recovery@example.test",
        passwordHash: "not-used-by-this-fixture",
        role: UserRole.ATTENDANT,
        active: false,
      },
    });
    const media = await prisma.mediaObject.create({
      data: {
        storageProvider: "local",
        originalFilename: "foto.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 0n,
        sha256: sha,
        metaMediaId: "meta-pg-inactive",
        status: MediaStatus.FAILED,
        downloadAttempts: 5,
      },
    });
    const contact = await prisma.contact.create({
      data: { name: "Contato inativo", whatsappId: "5511999990012" },
    });
    const conversation = await prisma.conversation.create({
      data: { contactId: contact.id, lastMessageAt: new Date() },
    });
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: MessageDirection.INBOUND,
        type: MessageType.IMAGE,
        mediaObjectId: media.id,
        status: MessageStatus.RECEIVED,
        externalTimestamp: new Date(),
      },
    });

    await expect(prismaMediaRepository.findVisibleById(media.id, user.id)).resolves.toBeNull();
    await prisma.user.update({ where: { id: user.id }, data: { active: true } });
    await expect(prismaMediaRepository.findVisibleById(media.id, user.id)).resolves.toMatchObject({ id: media.id });
    await prisma.user.update({ where: { id: user.id }, data: { active: false } });

    await expect(recoverMedia(user.id, media.id, true, {
      repository: prismaMediaRepository,
      storage: new LocalMediaStorage(root),
      provider,
      mediaRoot: root,
      inFlight: new Map(),
    })).rejects.toMatchObject({ status: 404 });
    expect(provider.calls).toBe(0);
    await expect(prisma.mediaObject.findUnique({ where: { id: media.id }, select: { status: true, downloadAttempts: true } }))
      .resolves.toEqual({ status: MediaStatus.FAILED, downloadAttempts: 5 });
  });
});
