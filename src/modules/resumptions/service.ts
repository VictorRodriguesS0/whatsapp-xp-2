import "server-only";

import { randomUUID } from "node:crypto";

import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import {
  ConversationResumptionStatus,
  MessageOperationalState,
  MessageStatus,
  WhatsAppPolicyMode,
  WhatsAppTemplateFunction,
  WhatsAppTemplateSyncStatus,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/http";
import type { SessionUser } from "@/modules/auth/session";
import { refreshResponseState } from "@/modules/conversations/shared-state";
import { SERVICE_WINDOW_MS } from "@/modules/messaging-policy/service";
import {
  sendPreparedTemplateMessage,
  type MessageServiceRecord,
} from "@/modules/messages/service";
import { messageUuidSchema } from "@/modules/messages/schemas";
import { publishRealtime } from "@/modules/realtime/hub";
import {
  renderServiceResumption,
  resolveServiceResumptionContactName,
} from "@/modules/templates/analysis";

import { resumeConversationSchema } from "./schemas";
import type {
  CreateResumptionReservation,
  FinalizeResumptionInput,
  ResumptionAttemptMessage,
  ResumptionEligibilityRecord,
  ResumptionRecord,
  ResumptionRepository,
  ResumptionResultDto,
  ResumptionServiceDependencies,
} from "./types";

const DEFAULT_RESERVATION_MS = 30_000;
const FRESH_SYNC_MS = 24 * 60 * 60 * 1_000;

type ResumptionPrismaClient = PrismaClient | Prisma.TransactionClient;

const resumptionSelect = {
  id: true,
  conversationId: true,
  sourceMessageId: true,
  templateId: true,
  messageId: true,
  sentByUserId: true,
  clientRequestId: true,
  status: true,
  renderedBody: true,
  templateName: true,
  templateLanguage: true,
  definitionHash: true,
  parameters: true,
  providerMessageId: true,
  providerAttemptedAt: true,
  reservationUntil: true,
  failureReason: true,
} as const;

const attemptMessageSelect = {
  id: true,
  status: true,
  operationalState: true,
  providerAttemptedAt: true,
  whatsappMessageId: true,
} as const;

function asResumptionRecord(
  value: Prisma.ConversationResumptionGetPayload<{
    select: typeof resumptionSelect;
  }>,
): ResumptionRecord {
  return value;
}

function createRepositoryForClient(
  client: ResumptionPrismaClient,
): ResumptionRepository {
  const repository: ResumptionRepository = {
    transaction: async (operation) => operation(repository),
    async lockConversationAndPolicy(conversationId) {
      const conversations = await client.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM conversations
        WHERE id = ${conversationId}::uuid
        FOR UPDATE
      `;
      if (conversations.length !== 1) {
        throw new HttpError(404, "Conversa não encontrada");
      }
      const configurations = await client.$queryRaw<Array<{ id: number }>>`
        SELECT id
        FROM whatsapp_policy_configuration
        WHERE id = 1
        FOR UPDATE
      `;
      if (configurations.length !== 1) {
        throw new HttpError(409, "Política do WhatsApp não configurada");
      }
    },
    async isActorActive(actorUserId) {
      return (
        (await client.user.count({
          where: { id: actorUserId, active: true },
        })) === 1
      );
    },
    async getEligibility(conversationId) {
      const conversation = await client.conversation.findUnique({
        where: { id: conversationId },
        select: {
          id: true,
          pendingCustomerMessageId: true,
          lastCustomerMessageAt: true,
          awaitingCustomerSince: true,
          contact: {
            select: {
              messagingOptOutAt: true,
              preferredName: true,
              name: true,
              whatsappAppContact: {
                select: { fullName: true, active: true },
              },
            },
          },
        },
      });
      const configuration = await client.whatsAppPolicyConfiguration.findUnique(
        {
          where: { id: 1 },
          select: {
            mode: true,
            lastTemplateSyncStatus: true,
            lastTemplateSyncSucceededAt: true,
          },
        },
      );
      const assignment = await client.whatsAppTemplateAssignment.findUnique({
        where: { function: WhatsAppTemplateFunction.SERVICE_RESUMPTION },
        select: {
          template: {
            select: {
              id: true,
              name: true,
              language: true,
              status: true,
              supported: true,
              parameterCount: true,
              definitionHash: true,
              bodyText: true,
              syncedAt: true,
            },
          },
        },
      });
      if (!conversation || !configuration) return null;
      const resolvedContactName = resolveServiceResumptionContactName({
        preferredName: conversation.contact.preferredName,
        whatsappAppName:
          conversation.contact.whatsappAppContact?.fullName ?? null,
        whatsappAppActive:
          conversation.contact.whatsappAppContact?.active === true,
        profileName: conversation.contact.name,
      });
      return {
        conversationId: conversation.id,
        pendingCustomerMessageId: conversation.pendingCustomerMessageId,
        lastCustomerMessageAt: conversation.lastCustomerMessageAt,
        awaitingCustomerSince: conversation.awaitingCustomerSince,
        messagingOptOutAt: conversation.contact.messagingOptOutAt,
        resolvedContactName,
        policyMode: configuration.mode,
        lastTemplateSyncStatus: configuration.lastTemplateSyncStatus,
        lastTemplateSyncSucceededAt: configuration.lastTemplateSyncSucceededAt,
        template: assignment?.template ?? null,
      } satisfies ResumptionEligibilityRecord;
    },
    async findByClientRequestId(clientRequestId) {
      const record = await client.conversationResumption.findUnique({
        where: { clientRequestId },
        select: resumptionSelect,
      });
      return record ? asResumptionRecord(record) : null;
    },
    async findActiveBySource(sourceMessageId) {
      const record = await client.conversationResumption.findFirst({
        where: {
          sourceMessageId,
          status: {
            in: [
              ConversationResumptionStatus.RESERVED,
              ConversationResumptionStatus.SEND_IN_FLIGHT,
              ConversationResumptionStatus.OUTCOME_UNKNOWN,
              ConversationResumptionStatus.SENT,
            ],
          },
        },
        select: resumptionSelect,
      });
      return record ? asResumptionRecord(record) : null;
    },
    async findAttemptMessage(clientRequestId, messageId) {
      return client.message.findFirst({
        where: messageId ? { id: messageId } : { clientRequestId },
        select: attemptMessageSelect,
      }) as Promise<ResumptionAttemptMessage | null>;
    },
    async expireReservation(id, reason) {
      await client.conversationResumption.updateMany({
        where: {
          id,
          status: ConversationResumptionStatus.RESERVED,
          providerAttemptedAt: null,
          messageId: null,
        },
        data: {
          status: ConversationResumptionStatus.FAILED,
          reservationUntil: null,
          failureReason: reason,
        },
      });
    },
    async createReservation(input) {
      const record = await client.conversationResumption.create({
        data: {
          ...input,
          parameters: input.parameters as Prisma.InputJsonValue,
          status: ConversationResumptionStatus.RESERVED,
        },
        select: resumptionSelect,
      });
      return asResumptionRecord(record);
    },
    async finalize(input) {
      const current = await client.conversationResumption.findUniqueOrThrow({
        where: { id: input.id },
        select: { conversationId: true },
      });
      const record = await client.conversationResumption.update({
        where: { id: input.id },
        data: {
          status: input.status,
          messageId: input.messageId,
          providerMessageId: input.providerMessageId,
          providerAttemptedAt: input.providerAttemptedAt,
          reservationUntil: null,
          failureReason: input.failureReason,
        },
        select: resumptionSelect,
      });
      if (input.status === ConversationResumptionStatus.SENT) {
        await client.conversation.update({
          where: { id: current.conversationId },
          data: {
            awaitingCustomerSince: input.finalizedAt,
            pendingCustomerMessageAt: null,
            pendingCustomerMessageId: null,
            serviceWindowStateVersion: { increment: 1 },
          },
        });
      } else if (input.status === ConversationResumptionStatus.FAILED) {
        await refreshResponseState(
          client as Prisma.TransactionClient,
          current.conversationId,
        );
      } else {
        await client.conversation.update({
          where: { id: current.conversationId },
          data: {
            pendingCustomerMessageAt: null,
            pendingCustomerMessageId: null,
            serviceWindowStateVersion: { increment: 1 },
          },
        });
      }
      return asResumptionRecord(record);
    },
  };
  return repository;
}

function isSerializationConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  );
}

function isUniqueConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

export function createPrismaResumptionRepository(
  client: PrismaClient,
): ResumptionRepository {
  const repository = createRepositoryForClient(client);
  repository.transaction = async (operation) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await client.$transaction(
          (transaction) => operation(createRepositoryForClient(transaction)),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (!isSerializationConflict(error) || attempt === 2) throw error;
      }
    }
    throw new Error("Unreachable resumption transaction state");
  };
  return repository;
}

const defaultDependencies: ResumptionServiceDependencies = {
  repository: createPrismaResumptionRepository(prisma),
  now: () => new Date(),
  createUuid: randomUUID,
  reservationMs: DEFAULT_RESERVATION_MS,
  sendPreparedTemplateMessage: (actor, conversationId, input) =>
    sendPreparedTemplateMessage(actor, conversationId, input),
  publishRealtime,
};

function safeDto(record: ResumptionRecord): ResumptionResultDto {
  return {
    id: record.id,
    clientRequestId: record.clientRequestId,
    status:
      record.status === ConversationResumptionStatus.SEND_IN_FLIGHT
        ? "RESERVED"
        : record.status,
    messageId: record.messageId,
  };
}

function publishSafely(
  dependencies: ResumptionServiceDependencies,
  conversationId: string,
): void {
  try {
    dependencies.publishRealtime({
      type: "conversation.updated",
      conversationId,
      revision: dependencies.now().toISOString(),
    });
  } catch {
    // Committed database state remains authoritative.
  }
}

function assertEligible(
  eligibility: ResumptionEligibilityRecord,
  now: Date,
): asserts eligibility is ResumptionEligibilityRecord & {
  pendingCustomerMessageId: string;
  template: NonNullable<ResumptionEligibilityRecord["template"]>;
} {
  if (eligibility.messagingOptOutAt) {
    throw new HttpError(
      409,
      "Este contato está marcado como não contatar.",
      "WHATSAPP_CONTACT_OPTED_OUT",
    );
  }
  const template = eligibility.template;
  const succeededAt = eligibility.lastTemplateSyncSucceededAt;
  const templateReady =
    eligibility.policyMode === WhatsAppPolicyMode.ACTIVE &&
    eligibility.lastTemplateSyncStatus ===
      WhatsAppTemplateSyncStatus.SUCCEEDED &&
    succeededAt !== null &&
    succeededAt.getTime() <= now.getTime() &&
    succeededAt.getTime() >= now.getTime() - FRESH_SYNC_MS &&
    template !== null &&
    template.status === "APPROVED" &&
    template.supported &&
    template.language === "pt_BR" &&
    template.parameterCount === 1 &&
    template.syncedAt.getTime() === succeededAt.getTime();
  if (!templateReady) {
    throw new HttpError(
      409,
      "Sincronize e selecione um template aprovado antes de retomar.",
      "WHATSAPP_TEMPLATE_NOT_READY",
    );
  }
  const windowClosed =
    eligibility.lastCustomerMessageAt !== null &&
    now.getTime() >=
      eligibility.lastCustomerMessageAt.getTime() + SERVICE_WINDOW_MS;
  if (
    !windowClosed ||
    eligibility.awaitingCustomerSince !== null ||
    eligibility.pendingCustomerMessageId === null
  ) {
    throw new HttpError(
      409,
      "Esta conversa não possui uma solicitação pendente elegível para retomada.",
      "WHATSAPP_RESUMPTION_ALREADY_STARTED",
    );
  }
}

function finalizationForMessage(
  id: string,
  message: Pick<
    MessageServiceRecord,
    | "id"
    | "status"
    | "operationalState"
    | "providerAttemptedAt"
    | "whatsappMessageId"
  >,
  finalizedAt: Date,
): FinalizeResumptionInput {
  if (
    message.status === MessageStatus.SENT &&
    message.operationalState === MessageOperationalState.SENT &&
    message.whatsappMessageId
  ) {
    return {
      id,
      status: ConversationResumptionStatus.SENT,
      messageId: message.id,
      providerMessageId: message.whatsappMessageId,
      providerAttemptedAt: message.providerAttemptedAt,
      failureReason: null,
      finalizedAt,
    };
  }
  if (
    message.status === MessageStatus.FAILED ||
    (message.providerAttemptedAt === null &&
      (message.operationalState === MessageOperationalState.READY ||
        message.operationalState === MessageOperationalState.LOCAL_FAILURE))
  ) {
    return {
      id,
      status: ConversationResumptionStatus.FAILED,
      messageId: message.id,
      providerMessageId: null,
      providerAttemptedAt: message.providerAttemptedAt,
      failureReason: "A retomada não foi aceita para envio",
      finalizedAt,
    };
  }
  return {
    id,
    status: ConversationResumptionStatus.OUTCOME_UNKNOWN,
    messageId: message.id,
    providerMessageId: message.whatsappMessageId,
    providerAttemptedAt: message.providerAttemptedAt,
    failureReason: null,
    finalizedAt,
  };
}

async function reconcileReservation(
  record: ResumptionRecord,
  repository: ResumptionRepository,
  now: Date,
): Promise<ResumptionRecord> {
  if (
    record.status !== ConversationResumptionStatus.RESERVED &&
    record.status !== ConversationResumptionStatus.SEND_IN_FLIGHT
  ) {
    return record;
  }
  const message = await repository.findAttemptMessage(
    record.clientRequestId,
    record.messageId,
  );
  if (message) {
    if (
      message.status === MessageStatus.PENDING &&
      message.operationalState === MessageOperationalState.READY &&
      message.providerAttemptedAt === null
    ) {
      return record;
    }
    return repository.finalize({
      ...finalizationForMessage(record.id, message, now),
      messageId: message.id,
    });
  }
  return record;
}

function resultOrThrow(record: ResumptionRecord): ResumptionResultDto {
  if (record.status === ConversationResumptionStatus.OUTCOME_UNKNOWN) {
    throw new HttpError(
      409,
      "O envio pode ter sido aceito pela Meta. Confirme antes de tentar novamente.",
      "WHATSAPP_RESUMPTION_OUTCOME_UNKNOWN",
    );
  }
  if (record.status === ConversationResumptionStatus.FAILED) {
    throw new HttpError(
      502,
      "Não foi possível enviar a retomada pelo WhatsApp.",
    );
  }
  return safeDto(record);
}

export async function resumeConversation(
  actor: SessionUser,
  conversationId: string,
  input: unknown,
  dependencies: ResumptionServiceDependencies = defaultDependencies,
): Promise<ResumptionResultDto> {
  const parsedConversationId = messageUuidSchema.parse(conversationId);
  const { clientRequestId } = resumeConversationSchema.parse(input);
  const at = dependencies.now();
  let reserved:
    | {
        kind: "READY";
        record: ResumptionRecord;
        created: boolean;
        reconciled: boolean;
      }
    | { kind: "CONFLICT"; record: ResumptionRecord; reconciled: boolean };

  try {
    reserved = await dependencies.repository.transaction(async (repository) => {
      await repository.lockConversationAndPolicy(parsedConversationId);
      if (!(await repository.isActorActive(actor.id))) {
        throw new HttpError(403, "Acesso negado");
      }
      const eligibility = await repository.getEligibility(parsedConversationId);
      if (!eligibility) throw new HttpError(404, "Conversa não encontrada");

      const sameRequest =
        await repository.findByClientRequestId(clientRequestId);
      if (sameRequest) {
        if (
          sameRequest.conversationId !== parsedConversationId ||
          sameRequest.sentByUserId !== actor.id
        ) {
          throw new HttpError(
            409,
            "Esta tentativa de retomada já foi utilizada.",
            "WHATSAPP_RESUMPTION_ALREADY_STARTED",
          );
        }
        const previousStatus = sameRequest.status;
        const previousMessageId = sameRequest.messageId;
        const reconciled = await reconcileReservation(
          sameRequest,
          repository,
          at,
        );
        return {
          kind: "READY" as const,
          record: reconciled,
          created: false,
          reconciled:
            reconciled.status !== previousStatus ||
            reconciled.messageId !== previousMessageId,
        };
      }

      assertEligible(eligibility, at);
      const active = await repository.findActiveBySource(
        eligibility.pendingCustomerMessageId,
      );
      if (active) {
        const previousStatus = active.status;
        const previousMessageId = active.messageId;
        const reconciled = await reconcileReservation(active, repository, at);
        if (reconciled.status === ConversationResumptionStatus.FAILED) {
          // A definitive failure frees the partial unique reservation.
        } else {
          const preparedMessage = await repository.findAttemptMessage(
            reconciled.clientRequestId,
            reconciled.messageId,
          );
          const staleWithoutAttempt =
            reconciled.status === ConversationResumptionStatus.RESERVED &&
            reconciled.messageId === null &&
            reconciled.providerAttemptedAt === null &&
            preparedMessage === null &&
            reconciled.reservationUntil !== null &&
            reconciled.reservationUntil.getTime() <= at.getTime();
          if (staleWithoutAttempt) {
            await repository.expireReservation(
              reconciled.id,
              "Reserva expirada antes do envio",
            );
          } else {
            return {
              kind: "CONFLICT" as const,
              record: reconciled,
              reconciled:
                reconciled.status !== previousStatus ||
                reconciled.messageId !== previousMessageId,
            };
          }
        }
      }

      const resolvedName =
        eligibility.resolvedContactName?.trim().slice(0, 80) || "cliente";
      const template = eligibility.template;
      return {
        kind: "READY" as const,
        created: true,
        reconciled: false,
        record: await repository.createReservation({
          id: dependencies.createUuid(),
          conversationId: parsedConversationId,
          sourceMessageId: eligibility.pendingCustomerMessageId,
          templateId: template.id,
          sentByUserId: actor.id,
          clientRequestId,
          renderedBody: renderServiceResumption(
            template.bodyText,
            resolvedName,
          ),
          templateName: template.name,
          templateLanguage: template.language,
          definitionHash: template.definitionHash,
          parameters: [{ type: "text", text: resolvedName }],
          reservationUntil: new Date(at.getTime() + dependencies.reservationMs),
        }),
      };
    });
  } catch (error) {
    if (isUniqueConflict(error)) {
      throw new HttpError(
        409,
        "Já existe uma retomada para esta solicitação.",
        "WHATSAPP_RESUMPTION_ALREADY_STARTED",
      );
    }
    throw error;
  }

  if (reserved.reconciled) {
    publishSafely(dependencies, parsedConversationId);
  }
  if (reserved.kind === "CONFLICT") {
    throw new HttpError(
      409,
      "Já existe uma retomada para esta solicitação.",
      "WHATSAPP_RESUMPTION_ALREADY_STARTED",
    );
  }
  if (!reserved.created) return resultOrThrow(reserved.record);
  const parameters = reserved.record.parameters as Array<{
    type: "text";
    text: string;
  }>;
  let message: MessageServiceRecord;
  try {
    message = await dependencies.sendPreparedTemplateMessage(
      actor,
      parsedConversationId,
      {
        clientRequestId,
        body: reserved.record.renderedBody,
        payload: {
          kind: "TEMPLATE",
          name: reserved.record.templateName,
          language: "pt_BR",
          definitionHash: reserved.record.definitionHash,
          bodyParameters: [parameters[0]],
        },
      },
    );
  } catch {
    const reconciled = await dependencies.repository.transaction(
      async (repository) => {
        await repository.lockConversationAndPolicy(parsedConversationId);
        const current =
          (await repository.findByClientRequestId(clientRequestId)) ??
          reserved.record;
        const withAttempt = await reconcileReservation(
          current,
          repository,
          dependencies.now(),
        );
        if (
          withAttempt.status !== ConversationResumptionStatus.RESERVED &&
          withAttempt.status !== ConversationResumptionStatus.SEND_IN_FLIGHT
        ) {
          return withAttempt;
        }
        const preparedMessage = await repository.findAttemptMessage(
          withAttempt.clientRequestId,
          withAttempt.messageId,
        );
        if (preparedMessage) {
          return withAttempt;
        }
        return repository.finalize({
          id: withAttempt.id,
          status: ConversationResumptionStatus.FAILED,
          messageId: null,
          providerMessageId: null,
          providerAttemptedAt: null,
          failureReason: "Falha local antes do envio",
          finalizedAt: dependencies.now(),
        });
      },
    );
    publishSafely(dependencies, parsedConversationId);
    return resultOrThrow(reconciled);
  }
  const finalized = await dependencies.repository.transaction(
    async (repository) => {
      await repository.lockConversationAndPolicy(parsedConversationId);
      return repository.finalize(
        finalizationForMessage(reserved.record.id, message, dependencies.now()),
      );
    },
  );
  publishSafely(dependencies, parsedConversationId);
  return resultOrThrow(finalized);
}
