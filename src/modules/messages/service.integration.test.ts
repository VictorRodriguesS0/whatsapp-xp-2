// @vitest-environment node

import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MessageDirection, MessageOperationalState, MessageStatus, MessageType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { resetTestDatabase, seedReadFixture } from "@/test/database";
import { WhatsAppProviderError } from "@/modules/whatsapp/meta-provider";
import { DemoWhatsAppProvider } from "@/modules/whatsapp/demo-provider";
import { LocalMediaStorage } from "@/modules/media/local-storage";
import type { MediaUploadSource } from "@/modules/whatsapp/provider";

import { MessageSendRateLimiter, prismaMessageRepository, retryMessage, sendMessage, type MessageServiceDependencies } from "./service";

const roots: string[] = [];

describe("outbound message PostgreSQL concurrency", () => {
  beforeEach(resetTestDatabase);
  afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

  it("persists one UI record for concurrent sends with one clientRequestId", async () => {
    const { conversation, victor } = await seedReadFixture();
    const actor = { id: victor.id, name: victor.name, email: victor.email, role: victor.role };
    const clientRequestId = randomUUID();

    const results = await Promise.all([
      sendMessage(actor, conversation.id, { type: MessageType.TEXT, clientRequestId, body: "Olá" }),
      sendMessage(actor, conversation.id, { type: MessageType.TEXT, clientRequestId, body: "Olá" }),
    ]);

    expect(results[0]!.id).toBe(results[1]!.id);
    await expect(prisma.message.count({ where: { clientRequestId } })).resolves.toBe(1);
    await expect(prisma.message.findUnique({ where: { clientRequestId }, select: { status: true, whatsappMessageId: true } }))
      .resolves.toMatchObject({ status: MessageStatus.SENT, whatsappMessageId: expect.stringMatching(/^demo-/) });
  });

  it("atomically claims one of two concurrent retries without creating another message", async () => {
    const { conversation, victor } = await seedReadFixture();
    const actor = { id: victor.id, name: victor.name, email: victor.email, role: victor.role };
    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        clientRequestId: randomUUID(),
        direction: MessageDirection.OUTBOUND,
        type: MessageType.TEXT,
        body: "Tentar novamente",
        sentByUserId: victor.id,
        status: MessageStatus.FAILED,
        operationalState: MessageOperationalState.REJECTED,
        failureReason: "Falha ao enviar mensagem",
        externalTimestamp: new Date(),
      },
    });

    const results = await Promise.allSettled([
      retryMessage(actor, message.id),
      retryMessage(actor, message.id),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
    await expect(prisma.message.count({ where: { id: message.id } })).resolves.toBe(1);
    await expect(prisma.message.findUnique({ where: { id: message.id }, select: { status: true } }))
      .resolves.toEqual({ status: MessageStatus.SENT });
  });

  it("returns not found without leaving a message when the conversation does not exist", async () => {
    const { victor } = await seedReadFixture();
    const actor = { id: victor.id, name: victor.name, email: victor.email, role: victor.role };

    await expect(
      sendMessage(actor, randomUUID(), {
        type: MessageType.TEXT,
        clientRequestId: randomUUID(),
        body: "Olá",
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(prisma.message.count()).resolves.toBe(0);
  });

  it("persists an unknown provider outcome as observable PENDING and refuses blind retry", async () => {
    const { conversation, victor } = await seedReadFixture();
    const actor = { id: victor.id, name: victor.name, email: victor.email, role: victor.role };
    const provider = new DemoWhatsAppProvider();
    provider.sendText = async () => { throw new WhatsAppProviderError("unknown"); };
    const dependencies: MessageServiceDependencies = {
      repository: prismaMessageRepository,
      storage: new LocalMediaStorage(process.env.MEDIA_ROOT!),
      provider,
      limiter: new MessageSendRateLimiter(),
      publishRealtime: () => undefined,
    };
    const result = await sendMessage(actor, conversation.id, { type: MessageType.TEXT, clientRequestId: randomUUID(), body: "Talvez enviado" }, dependencies);

    expect(result.status).toBe(MessageStatus.PENDING);
    await expect(prisma.message.findUnique({ where: { id: result.id }, select: { status: true, operationalState: true, providerAttemptedAt: true } }))
      .resolves.toMatchObject({ status: MessageStatus.PENDING, operationalState: MessageOperationalState.OUTCOME_UNKNOWN, providerAttemptedAt: expect.any(Date) });
    await expect(retryMessage(actor, result.id, dependencies)).rejects.toMatchObject({ status: 409 });
  });

  it("keeps provider acceptance non-retryable when markSent persistence fails", async () => {
    const { conversation, victor } = await seedReadFixture();
    const actor = { id: victor.id, name: victor.name, email: victor.email, role: victor.role };
    const repository = { ...prismaMessageRepository, markSent: async () => { throw new Error("database unavailable"); } };
    const dependencies: MessageServiceDependencies = {
      repository,
      storage: new LocalMediaStorage(process.env.MEDIA_ROOT!),
      provider: new DemoWhatsAppProvider(),
      limiter: new MessageSendRateLimiter(),
      publishRealtime: () => undefined,
    };
    const result = await sendMessage(actor, conversation.id, { type: MessageType.TEXT, clientRequestId: randomUUID(), body: "Aceita" }, dependencies);

    expect(result.status).toBe(MessageStatus.PENDING);
    await expect(prisma.message.findUnique({ where: { id: result.id }, select: { status: true, operationalState: true } }))
      .resolves.toEqual({ status: MessageStatus.PENDING, operationalState: MessageOperationalState.SEND_IN_FLIGHT });
    await expect(retryMessage(actor, result.id, dependencies)).rejects.toMatchObject({ status: 409 });
  });

  it("releases a pre-provider claim failure so the same clientRequestId resumes exactly once", async () => {
    const { conversation, victor } = await seedReadFixture();
    const actor = { id: victor.id, name: victor.name, email: victor.email, role: victor.role };
    const clientRequestId = randomUUID();
    const provider = new DemoWhatsAppProvider();
    let providerCalls = 0;
    provider.sendText = async () => { providerCalls += 1; return { whatsappMessageId: `wamid.${providerCalls}`, status: "SENT" }; };
    let failOnce = true;
    const repository = {
      ...prismaMessageRepository,
      async markProviderAttempt(...args: Parameters<typeof prismaMessageRepository.markProviderAttempt>) {
        if (failOnce) { failOnce = false; throw new Error("database unavailable"); }
        return prismaMessageRepository.markProviderAttempt(...args);
      },
    };
    const dependencies: MessageServiceDependencies = {
      repository,
      storage: new LocalMediaStorage(process.env.MEDIA_ROOT!),
      provider,
      limiter: new MessageSendRateLimiter(),
      publishRealtime: () => undefined,
    };

    const first = await sendMessage(actor, conversation.id, { type: MessageType.TEXT, clientRequestId, body: "Recuperável" }, dependencies);
    const resumed = await sendMessage(actor, conversation.id, { type: MessageType.TEXT, clientRequestId, body: "Recuperável" }, dependencies);

    expect(first.status).toBe(MessageStatus.PENDING);
    expect(resumed).toMatchObject({ id: first.id, status: MessageStatus.SENT });
    expect(providerCalls).toBe(1);
    await expect(prisma.message.count({ where: { clientRequestId } })).resolves.toBe(1);
  });

  it("lets one worker recover an expired READY lease without a duplicate provider call", async () => {
    const { conversation, victor } = await seedReadFixture();
    const actor = { id: victor.id, name: victor.name, email: victor.email, role: victor.role };
    const clientRequestId = randomUUID();
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        clientRequestId,
        direction: MessageDirection.OUTBOUND,
        type: MessageType.TEXT,
        body: "Lease expirado",
        sentByUserId: victor.id,
        status: MessageStatus.PENDING,
        operationalState: MessageOperationalState.READY,
        deliveryLeaseId: randomUUID(),
        deliveryLeaseUntil: new Date(Date.now() - 1_000),
        externalTimestamp: new Date(),
      },
    });
    const provider = new DemoWhatsAppProvider();
    let providerCalls = 0;
    provider.sendText = async () => {
      providerCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { whatsappMessageId: `wamid.${providerCalls}`, status: "SENT" };
    };
    const worker = (): MessageServiceDependencies => ({
      repository: prismaMessageRepository,
      storage: new LocalMediaStorage(process.env.MEDIA_ROOT!),
      provider,
      limiter: new MessageSendRateLimiter(),
      idempotencyInFlight: new Map(),
      publishRealtime: () => undefined,
    });

    await Promise.all([
      sendMessage(actor, conversation.id, { type: MessageType.TEXT, clientRequestId, body: "Lease expirado" }, worker()),
      sendMessage(actor, conversation.id, { type: MessageType.TEXT, clientRequestId, body: "Lease expirado" }, worker()),
    ]);

    expect(providerCalls).toBe(1);
    await expect(prisma.message.findUnique({ where: { clientRequestId }, select: { status: true, deliveryLeaseId: true } }))
      .resolves.toEqual({ status: MessageStatus.SENT, deliveryLeaseId: null });
  });

  it("repairs failed media with the same clientRequestId and one UI row", async () => {
    const { conversation, victor } = await seedReadFixture();
    const actor = { id: victor.id, name: victor.name, email: victor.email, role: victor.role };
    const clientRequestId = randomUUID();
    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        clientRequestId,
        direction: MessageDirection.OUTBOUND,
        type: MessageType.IMAGE,
        sentByUserId: victor.id,
        status: MessageStatus.FAILED,
        operationalState: MessageOperationalState.LOCAL_FAILURE,
        failureReason: "Falha local",
        externalTimestamp: new Date(),
      },
    });
    const provider = new DemoWhatsAppProvider();
    const mediaRoot = await mkdtemp(join(tmpdir(), "xp-message-repair-pg-"));
    roots.push(mediaRoot);
    let uploadCalls = 0;
    let sendCalls = 0;
    provider.uploadMedia = async (_input: MediaUploadSource) => { uploadCalls += 1; return { mediaId: "meta-repair" }; };
    provider.sendMedia = async () => { sendCalls += 1; return { whatsappMessageId: "wamid.repair", status: "SENT" }; };
    const dependencies: MessageServiceDependencies = {
      repository: prismaMessageRepository,
      storage: new LocalMediaStorage(mediaRoot),
      provider,
      limiter: new MessageSendRateLimiter(),
      publishRealtime: () => undefined,
    };
    const input = { type: MessageType.IMAGE, clientRequestId, file: { filename: "foto.jpg", mimeType: "image/jpeg", bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]) } } as const;

    const [first, second] = await Promise.all([
      sendMessage(actor, conversation.id, input, dependencies),
      sendMessage(actor, conversation.id, input, dependencies),
    ]);

    expect(first).toMatchObject({ id: message.id, status: MessageStatus.SENT });
    expect(second.id).toBe(message.id);
    expect(uploadCalls).toBe(1);
    expect(sendCalls).toBe(1);
    await expect(prisma.message.count({ where: { clientRequestId } })).resolves.toBe(1);
    await expect(prisma.mediaObject.count()).resolves.toBe(1);
  });

  it("keeps a committed media attachment when post-CAS hydration fails", async () => {
    const { conversation, victor } = await seedReadFixture();
    const actor = { id: victor.id, name: victor.name, email: victor.email, role: victor.role };
    const mediaRoot = await mkdtemp(join(tmpdir(), "xp-attach-hydrate-pg-"));
    roots.push(mediaRoot);
    const storage = new LocalMediaStorage(mediaRoot);
    const provider = new DemoWhatsAppProvider();
    let providerCalls = 0;
    provider.uploadMedia = async () => { providerCalls += 1; return { mediaId: "unused" }; };
    const repository = {
      ...prismaMessageRepository,
      async findById() { throw new Error("hydrate unavailable after attachment commit"); },
    };
    const clientRequestId = randomUUID();

    await expect(sendMessage(actor, conversation.id, {
      type: MessageType.IMAGE,
      clientRequestId,
      file: { filename: "foto.jpg", mimeType: "image/jpeg", bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]) },
    }, {
      repository, storage, provider, limiter: new MessageSendRateLimiter(), publishRealtime: () => undefined,
    })).rejects.toThrow("hydrate unavailable");

    expect(providerCalls).toBe(0);
    const committed = await prisma.message.findUniqueOrThrow({
      where: { clientRequestId },
      select: { status: true, operationalState: true, mediaObject: { select: { storageKey: true } } },
    });
    expect(committed).toMatchObject({ status: MessageStatus.PENDING, operationalState: MessageOperationalState.READY, mediaObject: { storageKey: expect.any(String) } });
    const stream = await storage.open(committed.mediaObject!.storageKey!);
    expect((await new Response(stream).arrayBuffer()).byteLength).toBe(4);
  });

  it("keeps the conservative provider-attempt boundary when post-CAS hydration fails", async () => {
    const { conversation, victor } = await seedReadFixture();
    const actor = { id: victor.id, name: victor.name, email: victor.email, role: victor.role };
    const provider = new DemoWhatsAppProvider();
    let providerCalls = 0;
    provider.sendText = async () => { providerCalls += 1; return { whatsappMessageId: "unused", status: "SENT" }; };
    let findCalls = 0;
    const repository = {
      ...prismaMessageRepository,
      async findById(id: string) {
        findCalls += 1;
        if (findCalls === 2) throw new Error("hydrate unavailable after attempt commit");
        return prismaMessageRepository.findById(id);
      },
    };
    const clientRequestId = randomUUID();

    await expect(sendMessage(actor, conversation.id, { type: MessageType.TEXT, clientRequestId, body: "Sem chamada" }, {
      repository,
      storage: new LocalMediaStorage(process.env.MEDIA_ROOT ?? ".media-test"),
      provider,
      limiter: new MessageSendRateLimiter(),
      publishRealtime: () => undefined,
    })).rejects.toThrow("hydrate unavailable");

    expect(providerCalls).toBe(0);
    await expect(prisma.message.findUnique({ where: { clientRequestId }, select: { status: true, operationalState: true, providerAttemptedAt: true, deliveryLeaseId: true } }))
      .resolves.toMatchObject({ status: MessageStatus.PENDING, operationalState: MessageOperationalState.SEND_IN_FLIGHT, providerAttemptedAt: expect.any(Date), deliveryLeaseId: null });
  });
});
