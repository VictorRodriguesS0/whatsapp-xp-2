// @vitest-environment node

import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { MessageDirection, MessageOperationalState, MessageStatus, MessageType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { resetTestDatabase, seedReadFixture } from "@/test/database";
import { WhatsAppProviderError } from "@/modules/whatsapp/meta-provider";
import { DemoWhatsAppProvider } from "@/modules/whatsapp/demo-provider";
import { LocalMediaStorage } from "@/modules/media/local-storage";

import { MessageSendRateLimiter, prismaMessageRepository, retryMessage, sendMessage, type MessageServiceDependencies } from "./service";

describe("outbound message PostgreSQL concurrency", () => {
  beforeEach(resetTestDatabase);

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
});
