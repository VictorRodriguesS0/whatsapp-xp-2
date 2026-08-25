// @vitest-environment node

import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import {
  ConversationResumptionStatus,
  MessageDirection,
  MessageStatus,
  MessageType,
  UserRole,
  WhatsAppPolicyMode,
  WhatsAppTemplateFunction,
  WhatsAppTemplateSyncStatus,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { refreshResponseState } from "@/modules/conversations/shared-state";
import { LocalMediaStorage } from "@/modules/media/local-storage";
import {
  MessageSendRateLimiter,
  prismaMessageRepository,
  sendPreparedTemplateMessage,
  type MessageServiceDependencies,
} from "@/modules/messages/service";
import { DemoWhatsAppProvider } from "@/modules/whatsapp/demo-provider";
import { WhatsAppProviderError } from "@/modules/whatsapp/meta-provider";
import { processWebhookEvents } from "@/modules/webhooks/process";
import { resetTestDatabase, seedReadFixture } from "@/test/database";

import {
  createPrismaResumptionRepository,
  resumeConversation,
} from "./service";
import type { ResumptionServiceDependencies } from "./types";

const now = new Date("2026-08-24T12:00:00.000Z");

async function seedEligibleConversation() {
  const { conversation, victor, marcos } = await seedReadFixture();
  const inbound = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: MessageDirection.INBOUND,
      type: MessageType.TEXT,
      body: "Vocês podem me avisar?",
      status: MessageStatus.RECEIVED,
      externalTimestamp: new Date(now.getTime() - 25 * 60 * 60 * 1_000),
    },
  });
  await refreshResponseState(prisma, conversation.id);
  const syncedAt = new Date(now.getTime() - 60_000);
  const template = await prisma.whatsAppTemplate.create({
    data: {
      metaId: "987654321",
      name: "retomar_atendimento",
      language: "pt_BR",
      category: "UTILITY",
      status: "APPROVED",
      qualityScore: "GREEN",
      components: [
        { type: "BODY", format: null, text: "Olá, {{1}}! Podemos continuar?" },
      ],
      bodyText: "Olá, {{1}}! Podemos continuar?",
      parameterCount: 1,
      supported: true,
      definitionHash: "a".repeat(64),
      syncedAt,
    },
  });
  await prisma.whatsAppTemplateAssignment.create({
    data: {
      function: WhatsAppTemplateFunction.SERVICE_RESUMPTION,
      templateId: template.id,
      assignedByUserId: victor.id,
    },
  });
  await prisma.whatsAppPolicyConfiguration.update({
    where: { id: 1 },
    data: {
      mode: WhatsAppPolicyMode.ACTIVE,
      lastTemplateSyncStatus: WhatsAppTemplateSyncStatus.SUCCEEDED,
      lastTemplateSyncAt: syncedAt,
      lastTemplateSyncSucceededAt: syncedAt,
      activatedAt: syncedAt,
      activatedByUserId: victor.id,
    },
  });
  return { conversation, victor, marcos, inbound };
}

function dependencies(
  provider: DemoWhatsAppProvider,
): ResumptionServiceDependencies {
  const messageDependencies: MessageServiceDependencies = {
    repository: prismaMessageRepository,
    storage: new LocalMediaStorage(process.env.MEDIA_ROOT ?? ".media-test"),
    provider,
    limiter: new MessageSendRateLimiter(),
    publishRealtime: () => undefined,
    now: () => now,
    createUuid: randomUUID,
  };
  return {
    repository: createPrismaResumptionRepository(prisma),
    now: () => now,
    createUuid: randomUUID,
    reservationMs: 30_000,
    sendPreparedTemplateMessage: (actor, conversationId, input) =>
      sendPreparedTemplateMessage(
        actor,
        conversationId,
        input,
        messageDependencies,
      ),
    publishRealtime: () => undefined,
  };
}

describe("service resumption in PostgreSQL", () => {
  beforeEach(resetTestDatabase);

  it("allows exactly one provider call when two attendants race", async () => {
    const { conversation, victor, marcos, inbound } =
      await seedEligibleConversation();
    const provider = new DemoWhatsAppProvider();
    const templateInputs: Array<Parameters<typeof provider.sendTemplate>[0]> =
      [];
    let releaseProvider!: () => void;
    const providerGate = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    provider.sendTemplate = async (input) => {
      templateInputs.push(input);
      await providerGate;
      return { whatsappMessageId: "wamid.pg-resumption", status: "SENT" };
    };
    const serviceDependencies = dependencies(provider);
    const attendantA = {
      id: victor.id,
      name: victor.name,
      email: victor.email,
      role: UserRole.ADMIN,
    };
    const attendantB = {
      id: marcos.id,
      name: marcos.name,
      email: marcos.email,
      role: UserRole.ATTENDANT,
    };

    const leftPromise = resumeConversation(
      attendantA,
      conversation.id,
      { clientRequestId: randomUUID() },
      serviceDependencies,
    );
    for (
      let attempt = 0;
      attempt < 100 && templateInputs.length === 0;
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(templateInputs).toHaveLength(1);
    const rightPromise = resumeConversation(
      attendantB,
      conversation.id,
      { clientRequestId: randomUUID() },
      serviceDependencies,
    );
    releaseProvider();
    const [left, right] = await Promise.allSettled([leftPromise, rightPromise]);

    expect(templateInputs).toHaveLength(1);
    expect([left.status, right.status].sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    await expect(
      prisma.conversationResumption.findMany({
        where: { sourceMessageId: inbound.id },
        select: { status: true, messageId: true, providerMessageId: true },
      }),
    ).resolves.toEqual([
      {
        status: ConversationResumptionStatus.SENT,
        messageId: expect.any(String),
        providerMessageId: "wamid.pg-resumption",
      },
    ]);
    await expect(
      prisma.conversation.findUniqueOrThrow({
        where: { id: conversation.id },
        select: { pendingCustomerMessageId: true, awaitingCustomerSince: true },
      }),
    ).resolves.toEqual({
      pendingCustomerMessageId: null,
      awaitingCustomerSince: now,
    });
    await expect(
      prisma.message.findFirstOrThrow({
        where: {
          conversationId: conversation.id,
          direction: MessageDirection.OUTBOUND,
        },
        select: {
          outboundPayloadKind: true,
          templateName: true,
          templateLanguage: true,
          templateComponents: true,
          templateDefinitionHash: true,
        },
      }),
    ).resolves.toMatchObject({
      outboundPayloadKind: "TEMPLATE",
      templateName: "retomar_atendimento",
      templateLanguage: "pt_BR",
      templateComponents: [
        {
          type: "body",
          parameters: [{ type: "text", text: "Contato de teste" }],
        },
      ],
      templateDefinitionHash: "a".repeat(64),
    });

    const customerReply = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        whatsappMessageId: "wamid.pg-customer-reply",
        direction: MessageDirection.INBOUND,
        type: MessageType.TEXT,
        body: "Sim",
        status: MessageStatus.RECEIVED,
        externalTimestamp: new Date(now.getTime() + 1_000),
      },
    });
    await refreshResponseState(prisma, conversation.id);
    await expect(
      prisma.conversation.findUniqueOrThrow({
        where: { id: conversation.id },
        select: {
          awaitingCustomerSince: true,
          pendingCustomerMessageId: true,
          lastCustomerMessageId: true,
        },
      }),
    ).resolves.toEqual({
      awaitingCustomerSince: null,
      pendingCustomerMessageId: customerReply.id,
      lastCustomerMessageId: customerReply.id,
    });
  });

  it("does not resume a request already answered by a Business App echo", async () => {
    const { conversation, victor, inbound } = await seedEligibleConversation();
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        whatsappMessageId: "wamid.business-app-answer",
        direction: MessageDirection.OUTBOUND,
        type: MessageType.TEXT,
        body: "Já respondi pelo celular",
        status: MessageStatus.SENT,
        externalTimestamp: new Date(
          inbound.externalTimestamp.getTime() + 1_000,
        ),
      },
    });
    await refreshResponseState(prisma, conversation.id);
    const provider = new DemoWhatsAppProvider();
    let providerCalls = 0;
    provider.sendTemplate = async () => {
      providerCalls += 1;
      return { whatsappMessageId: "wamid.must-not-send", status: "SENT" };
    };

    await expect(
      resumeConversation(
        {
          id: victor.id,
          name: victor.name,
          email: victor.email,
          role: victor.role,
        },
        conversation.id,
        { clientRequestId: randomUUID() },
        dependencies(provider),
      ),
    ).rejects.toMatchObject({
      status: 409,
      code: "WHATSAPP_RESUMPTION_ALREADY_STARTED",
    });
    expect(providerCalls).toBe(0);
  });

  it("restores the pending request when a status webhook confirms delivery failure", async () => {
    const { conversation, victor, inbound } = await seedEligibleConversation();
    const provider = new DemoWhatsAppProvider();
    provider.sendTemplate = async () => ({
      whatsappMessageId: "wamid.pg-template-status-failure",
      status: "SENT",
    });
    await resumeConversation(
      {
        id: victor.id,
        name: victor.name,
        email: victor.email,
        role: victor.role,
      },
      conversation.id,
      { clientRequestId: randomUUID() },
      dependencies(provider),
    );

    await processWebhookEvents([
      {
        kind: "status",
        whatsappMessageId: "wamid.pg-template-status-failure",
        timestamp: new Date(now.getTime() + 1_000),
        timestampRaw: String(Math.floor((now.getTime() + 1_000) / 1_000)),
        status: MessageStatus.FAILED,
        failureReason: "Falha de entrega",
      },
    ]);

    await expect(
      prisma.conversationResumption.findFirstOrThrow({
        select: { status: true, failureReason: true },
      }),
    ).resolves.toEqual({
      status: ConversationResumptionStatus.FAILED,
      failureReason: "Falha de entrega confirmada pela Meta",
    });
    await expect(
      prisma.conversation.findUniqueOrThrow({
        where: { id: conversation.id },
        select: { pendingCustomerMessageId: true, awaitingCustomerSince: true },
      }),
    ).resolves.toEqual({
      pendingCustomerMessageId: inbound.id,
      awaitingCustomerSince: null,
    });
  });

  it("restores the exact request after rejection and never retries uncertainty", async () => {
    const rejectedSeed = await seedEligibleConversation();
    const rejectedProvider = new DemoWhatsAppProvider();
    rejectedProvider.sendTemplate = async () => {
      throw new WhatsAppProviderError(
        "rejected",
        "raw provider diagnostic",
        "131047",
      );
    };
    await expect(
      resumeConversation(
        {
          id: rejectedSeed.victor.id,
          name: rejectedSeed.victor.name,
          email: rejectedSeed.victor.email,
          role: rejectedSeed.victor.role,
        },
        rejectedSeed.conversation.id,
        { clientRequestId: randomUUID() },
        dependencies(rejectedProvider),
      ),
    ).rejects.toMatchObject({ status: 502 });
    await expect(
      prisma.conversation.findUniqueOrThrow({
        where: { id: rejectedSeed.conversation.id },
        select: { pendingCustomerMessageId: true },
      }),
    ).resolves.toEqual({ pendingCustomerMessageId: rejectedSeed.inbound.id });
    expect(
      JSON.stringify(await prisma.conversationResumption.findFirstOrThrow()),
    ).not.toContain("raw provider diagnostic");

    await resetTestDatabase();
    const unknownSeed = await seedEligibleConversation();
    const unknownProvider = new DemoWhatsAppProvider();
    let providerCalls = 0;
    unknownProvider.sendTemplate = async () => {
      providerCalls += 1;
      throw new WhatsAppProviderError("unknown", "timeout with secret");
    };
    const clientRequestId = randomUUID();
    const unknownDependencies = dependencies(unknownProvider);
    const unknownActor = {
      id: unknownSeed.victor.id,
      name: unknownSeed.victor.name,
      email: unknownSeed.victor.email,
      role: unknownSeed.victor.role,
    };
    await expect(
      resumeConversation(
        unknownActor,
        unknownSeed.conversation.id,
        { clientRequestId },
        unknownDependencies,
      ),
    ).rejects.toMatchObject({
      status: 409,
      code: "WHATSAPP_RESUMPTION_OUTCOME_UNKNOWN",
    });
    await expect(
      resumeConversation(
        unknownActor,
        unknownSeed.conversation.id,
        { clientRequestId },
        unknownDependencies,
      ),
    ).rejects.toMatchObject({
      code: "WHATSAPP_RESUMPTION_OUTCOME_UNKNOWN",
    });
    expect(providerCalls).toBe(1);
    await expect(
      prisma.conversationResumption.findFirstOrThrow({
        select: { status: true, failureReason: true },
      }),
    ).resolves.toEqual({
      status: ConversationResumptionStatus.OUTCOME_UNKNOWN,
      failureReason: null,
    });
  });
});
