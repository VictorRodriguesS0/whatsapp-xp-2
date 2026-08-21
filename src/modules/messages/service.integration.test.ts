// @vitest-environment node

import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MessageDirection, MessageOperationalState, MessageStatus, MessageType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { resetTestDatabase, seedReadFixture } from "@/test/database";
import { WhatsAppProviderError } from "@/modules/whatsapp/meta-provider";
import { DemoWhatsAppProvider } from "@/modules/whatsapp/demo-provider";
import { LocalMediaStorage } from "@/modules/media/local-storage";
import type { MediaUploadSource } from "@/modules/whatsapp/provider";
import { refreshResponseState } from "@/modules/conversations/shared-state";
import { processWebhookEvents } from "@/modules/webhooks/process";

import {
  MessageSendRateLimiter,
  createPrismaMessageRepository,
  prismaMessageRepository,
  retryMessage,
  sendMessage,
  type MessageRateLimitReservation,
  type MessageServiceDependencies,
} from "./service";

const roots: string[] = [];

async function countStoredFiles(root: string): Promise<number> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && !entry.name.endsWith(".part")).length;
}

async function waitForAdvisoryLockWait(client: Client): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const result = await client.query<{ waiting: boolean }>(`
      SELECT EXISTS(
        SELECT 1
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND wait_event_type = 'Lock'
          AND wait_event = 'advisory'
      ) AS waiting
    `);
    if (result.rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Outbound transaction did not reach the advisory-lock barrier");
}

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

  it("clears the shared awaiting-response state when it persists an outbound reply", async () => {
    const { conversation, victor } = await seedReadFixture();
    const actor = { id: victor.id, name: victor.name, email: victor.email, role: victor.role };
    const inboundTimestamp = new Date("2026-08-21T12:00:00.000Z");
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: MessageDirection.INBOUND,
        type: MessageType.TEXT,
        body: "Preciso de ajuda",
        status: MessageStatus.RECEIVED,
        externalTimestamp: inboundTimestamp,
      },
    });
    await refreshResponseState(prisma, conversation.id);

    await sendMessage(actor, conversation.id, {
      type: MessageType.TEXT,
      clientRequestId: randomUUID(),
      body: "Como posso ajudar?",
    });

    await expect(
      prisma.conversation.findUniqueOrThrow({
        where: { id: conversation.id },
        select: { awaitingResponseSince: true },
      }),
    ).resolves.toEqual({ awaitingResponseSince: null });
  });

  it("preserves the earliest awaiting timestamp across consecutive inbound webhook persistence", async () => {
    const { conversation, victor } = await seedReadFixture();
    const firstInbound = new Date("2026-08-21T12:00:00.000Z");
    const secondInbound = new Date("2026-08-21T12:01:00.000Z");

    await processWebhookEvents([
      {
        kind: "message",
        whatsappMessageId: "wamid.task3-first-inbound",
        from: "5511999990000",
        contactName: "Contato de teste",
        timestamp: firstInbound,
        timestampRaw: String(firstInbound.getTime() / 1_000),
        type: MessageType.TEXT,
        body: "Primeira mensagem",
        media: null,
      },
    ]);
    await processWebhookEvents([
      {
        kind: "message",
        whatsappMessageId: "wamid.task3-second-inbound",
        from: "5511999990000",
        contactName: "Contato de teste",
        timestamp: secondInbound,
        timestampRaw: String(secondInbound.getTime() / 1_000),
        type: MessageType.TEXT,
        body: "Segunda mensagem",
        media: null,
      },
    ]);

    await expect(
      prisma.conversation.findUniqueOrThrow({
        where: { id: conversation.id },
        select: { awaitingResponseSince: true },
      }),
    ).resolves.toEqual({ awaitingResponseSince: firstInbound });
  });

  it("does not reopen awaiting state for an older delayed inbound persisted after an outbound reply", async () => {
    const { conversation, victor } = await seedReadFixture();
    const actor = { id: victor.id, name: victor.name, email: victor.email, role: victor.role };
    const delayedInbound = new Date(Date.now() - 60_000);

    await sendMessage(actor, conversation.id, {
      type: MessageType.TEXT,
      clientRequestId: randomUUID(),
      body: "Resposta enviada",
    });
    await processWebhookEvents([
      {
        kind: "message",
        whatsappMessageId: "wamid.task3-delayed-inbound",
        from: "5511999990000",
        contactName: "Contato de teste",
        timestamp: delayedInbound,
        timestampRaw: String(delayedInbound.getTime() / 1_000),
        type: MessageType.TEXT,
        body: "Mensagem atrasada",
        media: null,
      },
    ]);

    await expect(
      prisma.conversation.findUniqueOrThrow({
        where: { id: conversation.id },
        select: { awaitingResponseSince: true },
      }),
    ).resolves.toEqual({ awaitingResponseSince: null });
  });

  it("retries a blocked outbound state refresh after a later inbound transaction commits", async () => {
    const { conversation, victor } = await seedReadFixture();
    const actor = { id: victor.id, name: victor.name, email: victor.email, role: victor.role };
    const clientRequestId = randomUUID();
    const laterInbound = new Date(Date.now() + 60_000);
    const barrierLock = 2_026_082_103;
    const barrier = new Client({ connectionString: process.env.DATABASE_URL });
    let outbound: Promise<unknown> | null = null;

    await barrier.connect();
    try {
      await barrier.query("SELECT pg_advisory_lock($1)", [barrierLock]);
      await prisma.$executeRawUnsafe("CREATE SEQUENCE task3_outbound_refresh_attempts");
      await prisma.$executeRawUnsafe(`
        CREATE FUNCTION task3_block_outbound_refresh() RETURNS trigger AS $$
        BEGIN
          IF NEW.client_request_id = '${clientRequestId}'::uuid THEN
            PERFORM nextval('task3_outbound_refresh_attempts');
            PERFORM pg_advisory_xact_lock(${barrierLock});
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
      `);
      await prisma.$executeRawUnsafe(`
        CREATE TRIGGER task3_block_outbound_refresh
        BEFORE INSERT ON messages
        FOR EACH ROW EXECUTE FUNCTION task3_block_outbound_refresh()
      `);

      outbound = sendMessage(actor, conversation.id, {
        type: MessageType.TEXT,
        clientRequestId,
        body: "Resposta concorrente",
      });
      await waitForAdvisoryLockWait(barrier);

      await processWebhookEvents([
        {
          kind: "message",
          whatsappMessageId: "wamid.task3-racing-inbound",
          from: "5511999990000",
          contactName: "Contato de teste",
          timestamp: laterInbound,
          timestampRaw: String(laterInbound.getTime() / 1_000),
          type: MessageType.TEXT,
          body: "Mensagem concorrente posterior",
          media: null,
        },
      ]);
      await barrier.query("SELECT pg_advisory_unlock($1)", [barrierLock]);
      await outbound;

      await expect(
        prisma.conversation.findUniqueOrThrow({
          where: { id: conversation.id },
          select: { awaitingResponseSince: true },
        }),
      ).resolves.toEqual({ awaitingResponseSince: laterInbound });
      await expect(
        prisma.$queryRawUnsafe<Array<{ last_value: bigint }>>(
          "SELECT last_value FROM task3_outbound_refresh_attempts",
        ),
      ).resolves.toEqual([{ last_value: 2n }]);
    } finally {
      await barrier.query("SELECT pg_advisory_unlock($1)", [barrierLock]).catch(() => undefined);
      await outbound?.catch(() => undefined);
      await prisma.$executeRawUnsafe("DROP TRIGGER IF EXISTS task3_block_outbound_refresh ON messages");
      await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS task3_block_outbound_refresh()");
      await prisma.$executeRawUnsafe("DROP SEQUENCE IF EXISTS task3_outbound_refresh_attempts");
      await barrier.end();
    }
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

  it("rejects a BSUID-only destination before inserting or advancing activity", async () => {
    const { victor } = await seedReadFixture();
    const actor = {
      id: victor.id,
      name: victor.name,
      email: victor.email,
      role: victor.role,
    };
    const contact = await prisma.contact.create({
      data: {
        whatsappUserId: "BR.SendDestination",
        name: "WhatsApp",
      },
    });
    const initialActivity = new Date("2026-08-21T11:00:00.000Z");
    const conversation = await prisma.conversation.create({
      data: { contactId: contact.id, lastMessageAt: initialActivity },
    });
    const provider = new DemoWhatsAppProvider();
    let providerCalls = 0;
    provider.sendText = async () => {
      providerCalls += 1;
      throw new Error("provider must not be called");
    };
    const dependencies: MessageServiceDependencies = {
      repository: prismaMessageRepository,
      storage: new LocalMediaStorage(process.env.MEDIA_ROOT!),
      provider,
      limiter: new MessageSendRateLimiter(),
      publishRealtime: () => undefined,
    };

    await expect(
      sendMessage(
        actor,
        conversation.id,
        {
          type: MessageType.TEXT,
          clientRequestId: randomUUID(),
          body: "Não deve persistir",
        },
        dependencies,
      ),
    ).rejects.toMatchObject({
      status: 409,
      message: "Contato sem telefone disponível",
    });

    expect(providerCalls).toBe(0);
    await expect(
      prisma.message.count({ where: { conversationId: conversation.id } }),
    ).resolves.toBe(0);
    await expect(
      prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } }),
    ).resolves.toMatchObject({ lastMessageAt: initialActivity });
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

  it("reports NO_COMMIT and removes the stored file when an in-transaction attachment mutation rolls back", async () => {
    const { conversation, victor } = await seedReadFixture();
    const actor = { id: victor.id, name: victor.name, email: victor.email, role: victor.role };
    const mediaRoot = await mkdtemp(join(tmpdir(), "xp-attach-rollback-pg-"));
    roots.push(mediaRoot);
    const storage = new LocalMediaStorage(mediaRoot);
    const repository = createPrismaMessageRepository({
      async attachmentMutation(context, mutate) {
        await mutate(context);
        throw new Error("fault inside transaction");
      },
    });
    const clientRequestId = randomUUID();

    const input = {
      type: MessageType.IMAGE,
      clientRequestId,
      file: { filename: "foto.jpg", mimeType: "image/jpeg", bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]) },
    } as const;
    const dependencies = {
      repository, storage, provider: new DemoWhatsAppProvider(), limiter: new MessageSendRateLimiter(), publishRealtime: () => undefined,
    };

    const failed = await sendMessage(actor, conversation.id, input, dependencies);
    const repeated = await sendMessage(actor, conversation.id, input, dependencies);

    expect(failed).toMatchObject({ status: MessageStatus.FAILED, mediaObjectId: null });
    expect(repeated.id).toBe(failed.id);
    await expect(prisma.message.findUniqueOrThrow({ where: { clientRequestId }, select: { operationalState: true } }))
      .resolves.toEqual({ operationalState: MessageOperationalState.LOCAL_FAILURE });
    await expect(prisma.message.count({ where: { clientRequestId } })).resolves.toBe(1);
    await expect(prisma.mediaObject.count()).resolves.toBe(0);
    await expect(countStoredFiles(mediaRoot)).resolves.toBe(0);
  });

  it("preserves a committed file after an ambiguous outer transaction failure and does not accumulate on repetition", async () => {
    const { conversation, victor } = await seedReadFixture();
    const actor = { id: victor.id, name: victor.name, email: victor.email, role: victor.role };
    const mediaRoot = await mkdtemp(join(tmpdir(), "xp-attach-unknown-pg-"));
    roots.push(mediaRoot);
    const storage = new LocalMediaStorage(mediaRoot);
    const repository = createPrismaMessageRepository({
      async runAttachmentTransaction(operation) {
        const result = await prisma.$transaction(operation);
        throw Object.assign(new Error("connection lost after commit"), { committedResult: result });
      },
    });
    const provider = new DemoWhatsAppProvider();
    let providerCalls = 0;
    provider.uploadMedia = async () => { providerCalls += 1; return { mediaId: "unused" }; };
    const dependencies = { repository, storage, provider, limiter: new MessageSendRateLimiter(), publishRealtime: () => undefined };
    const clientRequestId = randomUUID();
    const input = {
      type: MessageType.IMAGE,
      clientRequestId,
      file: { filename: "foto.jpg", mimeType: "image/jpeg", bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]) },
    } as const;

    const uncertain = await sendMessage(actor, conversation.id, input, dependencies);
    const repeated = await sendMessage(actor, conversation.id, input, dependencies);

    expect(uncertain).toMatchObject({ status: MessageStatus.FAILED, failureReason: "Estado da mídia requer reconciliação", mediaObjectId: expect.any(String) });
    await expect(prisma.message.findUniqueOrThrow({ where: { clientRequestId }, select: { operationalState: true } }))
      .resolves.toEqual({ operationalState: MessageOperationalState.LOCAL_FAILURE });
    expect(repeated.id).toBe(uncertain.id);
    expect(providerCalls).toBe(0);
    await expect(prisma.mediaObject.count()).resolves.toBe(1);
    await expect(countStoredFiles(mediaRoot)).resolves.toBe(1);
  });

  it("retries confirmed P2034 rollbacks before attaching and delivering once", async () => {
    const { conversation, victor } = await seedReadFixture();
    const actor = { id: victor.id, name: victor.name, email: victor.email, role: victor.role };
    const mediaRoot = await mkdtemp(join(tmpdir(), "xp-attach-p2034-retry-pg-"));
    roots.push(mediaRoot);
    let transactionAttempts = 0;
    const repository = createPrismaMessageRepository({
      async runAttachmentTransaction(operation) {
        transactionAttempts += 1;
        if (transactionAttempts < 3) throw Object.assign(new Error("write conflict"), { code: "P2034" });
        return prisma.$transaction(operation);
      },
    });
    const provider = new DemoWhatsAppProvider();
    let uploadCalls = 0;
    provider.uploadMedia = async () => { uploadCalls += 1; return { mediaId: "meta-after-retry" }; };

    const result = await sendMessage(actor, conversation.id, {
      type: MessageType.IMAGE,
      clientRequestId: randomUUID(),
      file: { filename: "foto.jpg", mimeType: "image/jpeg", bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]) },
    }, {
      repository,
      storage: new LocalMediaStorage(mediaRoot),
      provider,
      limiter: new MessageSendRateLimiter(),
      publishRealtime: () => undefined,
    });

    expect(result.status).toBe(MessageStatus.SENT);
    expect(transactionAttempts).toBe(3);
    expect(uploadCalls).toBe(1);
    await expect(prisma.mediaObject.count()).resolves.toBe(1);
    await expect(countStoredFiles(mediaRoot)).resolves.toBe(1);
  });

  it("classifies exhausted confirmed P2034 rollbacks as NO_COMMIT and removes the file", async () => {
    const { conversation, victor } = await seedReadFixture();
    const actor = { id: victor.id, name: victor.name, email: victor.email, role: victor.role };
    const mediaRoot = await mkdtemp(join(tmpdir(), "xp-attach-p2034-exhausted-pg-"));
    roots.push(mediaRoot);
    let transactionAttempts = 0;
    const repository = createPrismaMessageRepository({
      async runAttachmentTransaction() {
        transactionAttempts += 1;
        throw Object.assign(new Error("write conflict"), { code: "P2034" });
      },
    });

    const result = await sendMessage(actor, conversation.id, {
      type: MessageType.IMAGE,
      clientRequestId: randomUUID(),
      file: { filename: "foto.jpg", mimeType: "image/jpeg", bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]) },
    }, {
      repository,
      storage: new LocalMediaStorage(mediaRoot),
      provider: new DemoWhatsAppProvider(),
      limiter: new MessageSendRateLimiter(),
      publishRealtime: () => undefined,
    });

    expect(result).toMatchObject({ status: MessageStatus.FAILED, mediaObjectId: null });
    expect(transactionAttempts).toBe(3);
    await expect(prisma.mediaObject.count()).resolves.toBe(0);
    await expect(countStoredFiles(mediaRoot)).resolves.toBe(0);
  });

  it("keeps the winning attachment and cleans the loser when its outer CAS_LOST result is rejected", async () => {
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
    const mediaRoot = await mkdtemp(join(tmpdir(), "xp-attach-cas-outer-pg-"));
    roots.push(mediaRoot);
    let rejectedCasResults = 0;
    const baseRepository = createPrismaMessageRepository({
      async runAttachmentTransaction(operation) {
        const result = await prisma.$transaction(operation);
        if ((result as unknown) === "CAS_LOST") {
          rejectedCasResults += 1;
          throw new Error("outer CAS result unavailable");
        }
        return result;
      },
    });
    const staleLoserSnapshot = await baseRepository.findByClientRequestId(clientRequestId);
    expect(staleLoserSnapshot).toMatchObject({ status: MessageStatus.FAILED, mediaObjectId: null });
    const attachmentResults: string[] = [];
    const loserRepository: MessageServiceDependencies["repository"] = {
      ...baseRepository,
      async findByClientRequestId() {
        return staleLoserSnapshot;
      },
      async attachStoredMedia(id, input) {
        const result = await baseRepository.attachStoredMedia(id, input);
        attachmentResults.push(result);
        return result;
      },
    };
    const storage = new LocalMediaStorage(mediaRoot);
    const provider = new DemoWhatsAppProvider();
    let uploadCalls = 0;
    let sendCalls = 0;
    provider.uploadMedia = async () => { uploadCalls += 1; return { mediaId: "meta-winner" }; };
    provider.sendMedia = async () => { sendCalls += 1; return { whatsappMessageId: "wamid.winner", status: "SENT" }; };
    const dependencies = (repository: MessageServiceDependencies["repository"]): MessageServiceDependencies => ({
      repository,
      storage,
      provider,
      limiter: new MessageSendRateLimiter(),
      idempotencyInFlight: new Map(),
      publishRealtime: () => undefined,
    });
    const input = {
      type: MessageType.IMAGE,
      clientRequestId,
      file: { filename: "foto.jpg", mimeType: "image/jpeg", bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]) },
    } as const;

    const first = await sendMessage(actor, conversation.id, input, dependencies(baseRepository));
    const second = await sendMessage(actor, conversation.id, input, dependencies(loserRepository));

    expect(first.id).toBe(message.id);
    expect(second.id).toBe(message.id);
    await expect(prisma.message.findUniqueOrThrow({ where: { id: message.id }, select: { status: true, operationalState: true, mediaObjectId: true } }))
      .resolves.toMatchObject({ status: MessageStatus.SENT, operationalState: MessageOperationalState.SENT, mediaObjectId: expect.any(String) });
    expect(uploadCalls).toBe(1);
    expect(sendCalls).toBe(1);
    expect(attachmentResults).toEqual(["CAS_LOST"]);
    expect(rejectedCasResults).toBe(1);
    await expect(prisma.mediaObject.count()).resolves.toBe(1);
    await expect(countStoredFiles(mediaRoot)).resolves.toBe(1);
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
    let refunds = 0;
    const limiter = new class extends MessageSendRateLimiter {
      override refund(reservation: MessageRateLimitReservation): void {
        refunds += 1;
        super.refund(reservation);
      }
    }();
    const clientRequestId = randomUUID();

    await expect(sendMessage(actor, conversation.id, { type: MessageType.TEXT, clientRequestId, body: "Sem chamada" }, {
      repository,
      storage: new LocalMediaStorage(process.env.MEDIA_ROOT ?? ".media-test"),
      provider,
      limiter,
      publishRealtime: () => undefined,
    })).rejects.toThrow("hydrate unavailable");

    expect(providerCalls).toBe(0);
    expect(refunds).toBe(0);
    await expect(prisma.message.findUnique({ where: { clientRequestId }, select: { status: true, operationalState: true, providerAttemptedAt: true, deliveryLeaseId: true } }))
      .resolves.toMatchObject({ status: MessageStatus.PENDING, operationalState: MessageOperationalState.SEND_IN_FLIGHT, providerAttemptedAt: expect.any(Date), deliveryLeaseId: null });
  });
});
