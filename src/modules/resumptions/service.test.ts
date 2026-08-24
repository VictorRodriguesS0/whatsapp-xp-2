// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  ConversationResumptionStatus,
  MessageDirection,
  MessageOperationalState,
  MessageStatus,
  MessageType,
  OutboundPayloadKind,
  UserRole,
  WhatsAppPolicyMode,
} from "@/generated/prisma/enums";
import type { SessionUser } from "@/modules/auth/session";
import type {
  MessageServiceRecord,
  PreparedTemplateMessageInput,
} from "@/modules/messages/service";

import { resumeConversation } from "./service";
import { resumeConversationSchema } from "./schemas";
import type {
  CreateResumptionReservation,
  FinalizeResumptionInput,
  ResumptionEligibilityRecord,
  ResumptionRecord,
  ResumptionRepository,
  ResumptionServiceDependencies,
} from "./types";

const now = new Date("2026-08-24T12:00:00.000Z");
const conversationId = "10000000-0000-4000-8000-000000000001";
const sourceMessageId = "20000000-0000-4000-8000-000000000001";
const templateId = "30000000-0000-4000-8000-000000000001";
const actor: SessionUser = {
  id: "40000000-0000-4000-8000-000000000001",
  name: "Ana",
  email: "ana@example.test",
  role: UserRole.ATTENDANT,
};

function eligibility(
  overrides: Partial<ResumptionEligibilityRecord> = {},
): ResumptionEligibilityRecord {
  const syncedAt = new Date(now.getTime() - 60_000);
  return {
    conversationId,
    pendingCustomerMessageId: sourceMessageId,
    lastCustomerMessageAt: new Date(now.getTime() - 25 * 60 * 60 * 1_000),
    awaitingCustomerSince: null,
    messagingOptOutAt: null,
    resolvedContactName: " Carlos ",
    policyMode: WhatsAppPolicyMode.ACTIVE,
    lastTemplateSyncStatus: "SUCCEEDED",
    lastTemplateSyncSucceededAt: syncedAt,
    template: {
      id: templateId,
      name: "retomar_atendimento",
      language: "pt_BR",
      status: "APPROVED",
      supported: true,
      parameterCount: 1,
      definitionHash: "a".repeat(64),
      bodyText: "Olá, {{1}}! Podemos continuar por aqui?",
      syncedAt,
    },
    ...overrides,
  };
}

class MemoryResumptionRepository implements ResumptionRepository {
  activeActors = new Set([actor.id]);
  eligibility = eligibility();
  records: ResumptionRecord[] = [];
  messages = new Map<string, MessageServiceRecord>();
  awaitingCustomerSince: Date | null = null;

  async transaction<T>(
    operation: (repository: ResumptionRepository) => Promise<T>,
  ): Promise<T> {
    return operation(this);
  }
  async lockConversationAndPolicy() {}
  async isActorActive(id: string) {
    return this.activeActors.has(id);
  }
  async getEligibility(id: string) {
    return id === this.eligibility.conversationId ? this.eligibility : null;
  }
  async findByClientRequestId(id: string) {
    return this.records.find((record) => record.clientRequestId === id) ?? null;
  }
  async findActiveBySource(id: string) {
    return (
      this.records.find(
        (record) =>
          record.sourceMessageId === id &&
          record.status !== ConversationResumptionStatus.FAILED,
      ) ?? null
    );
  }
  async findAttemptMessage(clientRequestId: string, messageId: string | null) {
    const message = messageId
      ? this.messages.get(messageId)
      : [...this.messages.values()].find(
          (candidate) => candidate.clientRequestId === clientRequestId,
        );
    return message
      ? {
          id: message.id,
          status: message.status,
          operationalState: message.operationalState,
          providerAttemptedAt: message.providerAttemptedAt,
          whatsappMessageId: message.whatsappMessageId,
        }
      : null;
  }
  async expireReservation(id: string, reason: string) {
    const record = this.records.find((candidate) => candidate.id === id)!;
    Object.assign(record, {
      status: ConversationResumptionStatus.FAILED,
      failureReason: reason,
      reservationUntil: null,
    });
  }
  async createReservation(input: CreateResumptionReservation) {
    const record: ResumptionRecord = {
      ...input,
      messageId: null,
      status: ConversationResumptionStatus.RESERVED,
      providerMessageId: null,
      providerAttemptedAt: null,
      failureReason: null,
    };
    this.records.push(record);
    return record;
  }
  async finalize(input: FinalizeResumptionInput) {
    const record = this.records.find((candidate) => candidate.id === input.id)!;
    Object.assign(record, input, { reservationUntil: null });
    if (input.status === ConversationResumptionStatus.SENT) {
      this.awaitingCustomerSince = input.finalizedAt;
      this.eligibility.awaitingCustomerSince = input.finalizedAt;
      this.eligibility.pendingCustomerMessageId = null;
    } else if (input.status === ConversationResumptionStatus.FAILED) {
      this.eligibility.pendingCustomerMessageId = record.sourceMessageId;
    } else {
      this.eligibility.pendingCustomerMessageId = null;
    }
    return record;
  }
}

function sentMessage(
  input: PreparedTemplateMessageInput,
  overrides: Partial<MessageServiceRecord> = {},
): MessageServiceRecord {
  return {
    id: "50000000-0000-4000-8000-000000000001",
    conversationId,
    whatsappMessageId: "wamid.sent",
    replyToMessageId: null,
    replyToWhatsappMessageId: null,
    replyToMessage: null,
    clientRequestId: input.clientRequestId,
    direction: MessageDirection.OUTBOUND,
    type: MessageType.TEXT,
    body: input.body,
    mediaObjectId: null,
    sentByUserId: actor.id,
    sentByUser: { id: actor.id, name: actor.name },
    status: MessageStatus.SENT,
    failureReason: null,
    outboundPayloadKind: OutboundPayloadKind.TEMPLATE,
    templateName: input.payload.name,
    templateLanguage: input.payload.language,
    templateComponents: [
      { type: "body", parameters: input.payload.bodyParameters },
    ],
    templateDefinitionHash: input.payload.definitionHash,
    operationalState: MessageOperationalState.SENT,
    providerAttemptedAt: now,
    deliveryLeaseId: null,
    deliveryLeaseUntil: null,
    externalTimestamp: now,
    createdAt: now,
    contactPhone: "5561999999999",
    mediaObject: null,
    ...overrides,
  };
}

function harness() {
  const repository = new MemoryResumptionRepository();
  const templateInputs: PreparedTemplateMessageInput[] = [];
  const events: string[] = [];
  let messageOverrides: Partial<MessageServiceRecord> = {};
  const dependencies: ResumptionServiceDependencies = {
    repository,
    now: () => now,
    createUuid: () => "60000000-0000-4000-8000-000000000001",
    reservationMs: 30_000,
    async sendPreparedTemplateMessage(_actor, _conversationId, input) {
      templateInputs.push(input);
      const message = sentMessage(input, messageOverrides);
      repository.messages.set(message.id, message);
      return message;
    },
    publishRealtime(event) {
      events.push(event.type);
    },
  };
  return {
    repository,
    dependencies,
    templateInputs,
    events,
    setMessageOverrides(value: Partial<MessageServiceRecord>) {
      messageOverrides = value;
    },
  };
}

describe("service resumption", () => {
  it("accepts only a strict normalized client request id", () => {
    expect(
      resumeConversationSchema.parse({
        clientRequestId: "A0000000-0000-4000-8000-000000000001",
      }),
    ).toEqual({
      clientRequestId: "a0000000-0000-4000-8000-000000000001",
    });
    expect(() =>
      resumeConversationSchema.parse({
        clientRequestId: "a0000000-0000-4000-8000-000000000001",
        templateId,
      }),
    ).toThrow();
  });

  it("reserves the exact unanswered request and sends the assigned snapshot", async () => {
    const state = harness();
    const result = await resumeConversation(
      actor,
      conversationId,
      { clientRequestId: "70000000-0000-4000-8000-000000000001" },
      state.dependencies,
    );

    expect(result).toMatchObject({
      status: "SENT",
      messageId: expect.any(String),
    });
    expect(state.templateInputs).toEqual([
      {
        clientRequestId: "70000000-0000-4000-8000-000000000001",
        body: "Olá, Carlos! Podemos continuar por aqui?",
        payload: {
          kind: "TEMPLATE",
          name: "retomar_atendimento",
          language: "pt_BR",
          definitionHash: "a".repeat(64),
          bodyParameters: [{ type: "text", text: "Carlos" }],
        },
      },
    ]);
    expect(state.repository.records[0]).toMatchObject({
      sourceMessageId,
      templateId,
      status: ConversationResumptionStatus.SENT,
      renderedBody: "Olá, Carlos! Podemos continuar por aqui?",
    });
    expect(state.repository.awaitingCustomerSince).toEqual(now);
    expect(state.events).toEqual(["conversation.updated"]);
  });

  it.each([
    [
      "inactive policy",
      { policyMode: WhatsAppPolicyMode.INACTIVE },
      "WHATSAPP_TEMPLATE_NOT_READY",
    ],
    ["opt out", { messagingOptOutAt: now }, "WHATSAPP_CONTACT_OPTED_OUT"],
    [
      "already answered",
      { pendingCustomerMessageId: null },
      "WHATSAPP_RESUMPTION_ALREADY_STARTED",
    ],
    [
      "open window",
      { lastCustomerMessageAt: new Date(now.getTime() - 60_000) },
      "WHATSAPP_RESUMPTION_ALREADY_STARTED",
    ],
    [
      "rejected template",
      { template: { ...eligibility().template!, status: "REJECTED" } },
      "WHATSAPP_TEMPLATE_NOT_READY",
    ],
    [
      "stale template sync",
      {
        lastTemplateSyncSucceededAt: new Date(
          now.getTime() - 25 * 60 * 60 * 1_000,
        ),
      },
      "WHATSAPP_TEMPLATE_NOT_READY",
    ],
  ] as const)("blocks %s before sending", async (_label, override, code) => {
    const state = harness();
    Object.assign(state.repository.eligibility, override);
    await expect(
      resumeConversation(
        actor,
        conversationId,
        { clientRequestId: "70000000-0000-4000-8000-000000000002" },
        state.dependencies,
      ),
    ).rejects.toMatchObject({ status: 409, code });
    expect(state.templateInputs).toHaveLength(0);
  });

  it("is idempotent for the same request and rejects another active attempt", async () => {
    const state = harness();
    const request = { clientRequestId: "70000000-0000-4000-8000-000000000003" };
    const first = await resumeConversation(
      actor,
      conversationId,
      request,
      state.dependencies,
    );
    const repeated = await resumeConversation(
      actor,
      conversationId,
      request,
      state.dependencies,
    );
    expect(repeated).toEqual(first);
    expect(state.templateInputs).toHaveLength(1);

    await expect(
      resumeConversation(
        actor,
        conversationId,
        { clientRequestId: "70000000-0000-4000-8000-000000000004" },
        state.dependencies,
      ),
    ).rejects.toMatchObject({
      status: 409,
      code: "WHATSAPP_RESUMPTION_ALREADY_STARTED",
    });
  });

  it("expires only a stale reservation without any provider or message attempt", async () => {
    const state = harness();
    state.repository.records.push({
      id: "60000000-0000-4000-8000-000000000099",
      conversationId,
      sourceMessageId,
      templateId,
      messageId: null,
      sentByUserId: actor.id,
      clientRequestId: "70000000-0000-4000-8000-000000000099",
      status: ConversationResumptionStatus.RESERVED,
      renderedBody: "Olá, cliente!",
      templateName: "retomar_atendimento",
      templateLanguage: "pt_BR",
      definitionHash: "a".repeat(64),
      parameters: [{ type: "text", text: "cliente" }],
      providerMessageId: null,
      providerAttemptedAt: null,
      reservationUntil: new Date(now.getTime() - 1),
      failureReason: null,
    });

    await expect(
      resumeConversation(
        actor,
        conversationId,
        { clientRequestId: "70000000-0000-4000-8000-000000000100" },
        state.dependencies,
      ),
    ).resolves.toMatchObject({ status: "SENT" });
    expect(state.repository.records.map(({ status }) => status)).toEqual([
      ConversationResumptionStatus.FAILED,
      ConversationResumptionStatus.SENT,
    ]);
    expect(state.templateInputs).toHaveLength(1);
  });

  it("rejects a client request id already used by another conversation", async () => {
    const state = harness();
    state.repository.records.push({
      id: "60000000-0000-4000-8000-000000000098",
      conversationId: "10000000-0000-4000-8000-000000000098",
      sourceMessageId: "20000000-0000-4000-8000-000000000098",
      templateId,
      messageId: null,
      sentByUserId: actor.id,
      clientRequestId: "70000000-0000-4000-8000-000000000098",
      status: ConversationResumptionStatus.RESERVED,
      renderedBody: "Olá, cliente!",
      templateName: "retomar_atendimento",
      templateLanguage: "pt_BR",
      definitionHash: "a".repeat(64),
      parameters: [{ type: "text", text: "cliente" }],
      providerMessageId: null,
      providerAttemptedAt: null,
      reservationUntil: new Date(now.getTime() - 1),
      failureReason: null,
    });

    await expect(
      resumeConversation(
        actor,
        conversationId,
        { clientRequestId: "70000000-0000-4000-8000-000000000098" },
        state.dependencies,
      ),
    ).rejects.toMatchObject({
      status: 409,
      code: "WHATSAPP_RESUMPTION_ALREADY_STARTED",
    });
    expect(state.templateInputs).toHaveLength(0);
  });

  it("reopens eligibility after a definitive failure and confirms unknown outcomes", async () => {
    const failed = harness();
    failed.setMessageOverrides({
      whatsappMessageId: null,
      status: MessageStatus.FAILED,
      operationalState: MessageOperationalState.REJECTED,
      failureReason: "Meta rejeitou a mensagem",
    });
    await expect(
      resumeConversation(
        actor,
        conversationId,
        { clientRequestId: "70000000-0000-4000-8000-000000000005" },
        failed.dependencies,
      ),
    ).rejects.toMatchObject({ status: 502 });
    expect(failed.repository.records[0]?.status).toBe(
      ConversationResumptionStatus.FAILED,
    );
    expect(failed.repository.eligibility.pendingCustomerMessageId).toBe(
      sourceMessageId,
    );

    const unknown = harness();
    unknown.setMessageOverrides({
      whatsappMessageId: null,
      status: MessageStatus.PENDING,
      operationalState: MessageOperationalState.OUTCOME_UNKNOWN,
    });
    await expect(
      resumeConversation(
        actor,
        conversationId,
        { clientRequestId: "70000000-0000-4000-8000-000000000006" },
        unknown.dependencies,
      ),
    ).rejects.toMatchObject({
      status: 409,
      code: "WHATSAPP_RESUMPTION_OUTCOME_UNKNOWN",
    });
    expect(unknown.repository.records[0]?.status).toBe(
      ConversationResumptionStatus.OUTCOME_UNKNOWN,
    );
  });

  it("reconciles a crashed provider attempt to unknown without calling the provider again", async () => {
    const state = harness();
    const clientRequestId = "70000000-0000-4000-8000-000000000007";
    const reservation: ResumptionRecord = {
      id: "60000000-0000-4000-8000-000000000007",
      conversationId,
      sourceMessageId,
      templateId,
      messageId: null,
      sentByUserId: actor.id,
      clientRequestId,
      status: ConversationResumptionStatus.RESERVED,
      renderedBody: "Olá, Carlos!",
      templateName: "retomar_atendimento",
      templateLanguage: "pt_BR",
      definitionHash: "a".repeat(64),
      parameters: [{ type: "text", text: "Carlos" }],
      providerMessageId: null,
      providerAttemptedAt: null,
      reservationUntil: new Date(now.getTime() - 1),
      failureReason: null,
    };
    state.repository.records.push(reservation);
    const preparedInput: PreparedTemplateMessageInput = {
      clientRequestId,
      body: reservation.renderedBody,
      payload: {
        kind: "TEMPLATE",
        name: reservation.templateName,
        language: "pt_BR",
        definitionHash: reservation.definitionHash,
        bodyParameters: [{ type: "text", text: "Carlos" }],
      },
    };
    const attempted = sentMessage(preparedInput, {
      whatsappMessageId: null,
      status: MessageStatus.PENDING,
      operationalState: MessageOperationalState.SEND_IN_FLIGHT,
      providerAttemptedAt: now,
    });
    state.repository.messages.set(attempted.id, attempted);

    await expect(
      resumeConversation(
        actor,
        conversationId,
        { clientRequestId },
        state.dependencies,
      ),
    ).rejects.toMatchObject({
      code: "WHATSAPP_RESUMPTION_OUTCOME_UNKNOWN",
    });
    expect(state.templateInputs).toHaveLength(0);
    expect(reservation).toMatchObject({
      status: ConversationResumptionStatus.OUTCOME_UNKNOWN,
      messageId: attempted.id,
    });
    expect(state.events).toEqual(["conversation.updated"]);
  });

  it("keeps a prepared READY message reserved while another request may still claim it", async () => {
    const state = harness();
    const clientRequestId = "70000000-0000-4000-8000-000000000008";
    const reservation: ResumptionRecord = {
      id: "60000000-0000-4000-8000-000000000008",
      conversationId,
      sourceMessageId,
      templateId,
      messageId: null,
      sentByUserId: actor.id,
      clientRequestId,
      status: ConversationResumptionStatus.RESERVED,
      renderedBody: "Olá, Carlos!",
      templateName: "retomar_atendimento",
      templateLanguage: "pt_BR",
      definitionHash: "a".repeat(64),
      parameters: [{ type: "text", text: "Carlos" }],
      providerMessageId: null,
      providerAttemptedAt: null,
      reservationUntil: new Date(now.getTime() - 1),
      failureReason: null,
    };
    state.repository.records.push(reservation);
    const preparedInput: PreparedTemplateMessageInput = {
      clientRequestId,
      body: reservation.renderedBody,
      payload: {
        kind: "TEMPLATE",
        name: reservation.templateName,
        language: "pt_BR",
        definitionHash: reservation.definitionHash,
        bodyParameters: [{ type: "text", text: "Carlos" }],
      },
    };
    const ready = sentMessage(preparedInput, {
      whatsappMessageId: null,
      status: MessageStatus.PENDING,
      operationalState: MessageOperationalState.READY,
      providerAttemptedAt: null,
    });
    state.repository.messages.set(ready.id, ready);

    await expect(
      resumeConversation(
        actor,
        conversationId,
        { clientRequestId },
        state.dependencies,
      ),
    ).resolves.toMatchObject({ status: "RESERVED", messageId: null });
    await expect(
      resumeConversation(
        actor,
        conversationId,
        { clientRequestId: "70000000-0000-4000-8000-000000000009" },
        state.dependencies,
      ),
    ).rejects.toMatchObject({
      code: "WHATSAPP_RESUMPTION_ALREADY_STARTED",
    });
    expect(reservation.status).toBe(ConversationResumptionStatus.RESERVED);
    expect(state.templateInputs).toHaveLength(0);
    expect(state.events).toHaveLength(0);
  });
});
