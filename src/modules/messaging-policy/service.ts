import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
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
import {
  renderServiceResumption,
  resolveServiceResumptionContactName,
} from "@/modules/templates/analysis";

import type {
  ServiceWindowCalculation,
  ServiceWindowDto,
} from "./types";

export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1_000;
export const TEMPLATE_SYNC_FRESHNESS_MS = 24 * 60 * 60 * 1_000;

export type MessagingPolicyRecord = {
  enforcement: "INACTIVE" | "ACTIVE";
  lastCustomerMessageAt: Date | null;
  pendingCustomerMessageId: string | null;
  awaitingCustomerSince: Date | null;
  confirmingResumption: boolean;
  messagingOptOutAt: Date | null;
  resumptionTemplate: {
    templateName: string;
    language: string;
    previewBody: string;
  } | null;
};

export type MessagingPolicyRepository = {
  findPolicyRecord(
    conversationId: string,
    now: Date,
  ): Promise<MessagingPolicyRecord | null>;
};

type MessagingPolicyPrismaClient = Pick<
  PrismaClient,
  | "conversation"
  | "message"
  | "whatsAppPolicyConfiguration"
  | "whatsAppTemplateAssignment"
>;

export function calculateServiceWindow(
  lastCustomerMessageAt: Date | null,
  now: Date,
): ServiceWindowCalculation {
  if (!lastCustomerMessageAt) {
    return { status: "CLOSED", closesAt: null };
  }

  const closesAt = new Date(
    lastCustomerMessageAt.getTime() + SERVICE_WINDOW_MS,
  );
  return {
    status: now.getTime() < closesAt.getTime() ? "OPEN" : "CLOSED",
    closesAt,
  };
}

export type ServiceResumptionTemplateCandidate = {
  name: string;
  language: string;
  status: string;
  supported: boolean;
  parameterCount: number;
  bodyText: string;
  syncedAt: Date;
};

export type ConfirmingResumptionCandidate = {
  sourceMessageId: string;
  status: ConversationResumptionStatus;
  reservationUntil: Date | null;
  hasBlockingAttempt?: boolean;
};

export type PreparedResumptionAttempt = {
  status: MessageStatus;
  operationalState: MessageOperationalState;
  providerAttemptedAt: Date | null;
};

export function preparedAttemptBlocksResumption(
  attempt: PreparedResumptionAttempt | null,
): boolean {
  if (!attempt) return false;
  if (
    attempt.status === MessageStatus.PENDING &&
    attempt.operationalState === MessageOperationalState.READY &&
    attempt.providerAttemptedAt === null
  ) {
    return true;
  }
  if (attempt.status === MessageStatus.FAILED) return false;
  return !(
    attempt.providerAttemptedAt === null &&
    attempt.operationalState === MessageOperationalState.LOCAL_FAILURE
  );
}

export function isConfirmingCurrentResumption(
  lastCustomerMessageId: string | null,
  candidates: ConfirmingResumptionCandidate[],
  now: Date,
): boolean {
  if (!lastCustomerMessageId) return false;
  return candidates.some((candidate) => {
    if (candidate.sourceMessageId !== lastCustomerMessageId) return false;
    if (candidate.status === ConversationResumptionStatus.RESERVED) {
      return (
        (candidate.reservationUntil !== null &&
          candidate.reservationUntil.getTime() > now.getTime()) ||
        candidate.hasBlockingAttempt === true
      );
    }
    return (
      candidate.status === ConversationResumptionStatus.SEND_IN_FLIGHT ||
      candidate.status === ConversationResumptionStatus.OUTCOME_UNKNOWN
    );
  });
}

export function resolveServiceResumptionTemplate(
  configuration: {
    mode: "INACTIVE" | "ACTIVE";
    lastTemplateSyncStatus: "NEVER" | "SUCCEEDED" | "FAILED";
    lastTemplateSyncSucceededAt: Date | null;
  } | null,
  template: ServiceResumptionTemplateCandidate | null,
  now: Date,
): { templateName: string; language: string; bodyText: string } | null {
  const succeededAt = configuration?.lastTemplateSyncSucceededAt ?? null;
  const ready =
    configuration?.mode === WhatsAppPolicyMode.ACTIVE &&
    configuration.lastTemplateSyncStatus === WhatsAppTemplateSyncStatus.SUCCEEDED &&
    succeededAt !== null &&
    succeededAt.getTime() <= now.getTime() &&
    succeededAt.getTime() >= now.getTime() - TEMPLATE_SYNC_FRESHNESS_MS &&
    template !== null &&
    template.status === "APPROVED" &&
    template.supported &&
    template.language === "pt_BR" &&
    template.parameterCount === 1 &&
    template.syncedAt.getTime() === succeededAt.getTime();

  return ready && template
    ? {
        templateName: template.name,
        language: template.language,
        bodyText: template.bodyText,
      }
    : null;
}

export function createPrismaMessagingPolicyRepository(
  client: MessagingPolicyPrismaClient,
): MessagingPolicyRepository {
  return {
    async findPolicyRecord(conversationId, now) {
      const [configuration, conversation, assignment] = await Promise.all([
        client.whatsAppPolicyConfiguration.findUnique({
          where: { id: 1 },
          select: {
            mode: true,
            lastTemplateSyncStatus: true,
            lastTemplateSyncSucceededAt: true,
          },
        }),
        client.conversation.findUnique({
          where: { id: conversationId },
          select: {
            lastCustomerMessageAt: true,
            lastCustomerMessageId: true,
            pendingCustomerMessageId: true,
            awaitingCustomerSince: true,
            resumptions: {
              where: {
                status: {
                  in: [
                    ConversationResumptionStatus.RESERVED,
                    ConversationResumptionStatus.SEND_IN_FLIGHT,
                    ConversationResumptionStatus.OUTCOME_UNKNOWN,
                  ],
                },
              },
              orderBy: { createdAt: "desc" },
              take: 1,
              select: {
                clientRequestId: true,
                sourceMessageId: true,
                status: true,
                reservationUntil: true,
              },
            },
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
        }),
        client.whatsAppTemplateAssignment.findUnique({
          where: { function: WhatsAppTemplateFunction.SERVICE_RESUMPTION },
          select: {
            template: {
              select: {
                name: true,
                language: true,
                bodyText: true,
                status: true,
                supported: true,
                parameterCount: true,
                syncedAt: true,
              },
            },
          },
        }),
      ]);

      if (!conversation) {
        return null;
      }

      const currentResumption = conversation.resumptions[0] ?? null;
      const preparedAttempt =
        currentResumption?.status === ConversationResumptionStatus.RESERVED
          ? await client.message.findUnique({
              where: { clientRequestId: currentResumption.clientRequestId },
              select: {
                status: true,
                operationalState: true,
                providerAttemptedAt: true,
              },
            })
          : null;

      const template = resolveServiceResumptionTemplate(
        configuration,
        assignment?.template ?? null,
        now,
      );
      const resolvedContactName = resolveServiceResumptionContactName({
        preferredName: conversation.contact.preferredName,
        whatsappAppName: conversation.contact.whatsappAppContact?.fullName ?? null,
        whatsappAppActive:
          conversation.contact.whatsappAppContact?.active === true,
        profileName: conversation.contact.name,
      });

      return {
        enforcement:
          configuration?.mode === WhatsAppPolicyMode.ACTIVE
            ? "ACTIVE"
            : "INACTIVE",
        lastCustomerMessageAt: conversation.lastCustomerMessageAt,
        pendingCustomerMessageId: conversation.pendingCustomerMessageId,
        awaitingCustomerSince: conversation.awaitingCustomerSince,
        confirmingResumption: isConfirmingCurrentResumption(
          conversation.lastCustomerMessageId,
          conversation.resumptions.map((candidate) => ({
            ...candidate,
            hasBlockingAttempt: preparedAttemptBlocksResumption(
              preparedAttempt,
            ),
          })),
          now,
        ),
        messagingOptOutAt: conversation.contact.messagingOptOutAt,
        resumptionTemplate: template
          ? {
              templateName: template.templateName,
              language: template.language,
              previewBody: renderServiceResumption(
                template.bodyText,
                resolvedContactName,
              ),
            }
          : null,
      };
    },
  };
}

const prismaMessagingPolicyRepository = createPrismaMessagingPolicyRepository(
  prisma,
);

export function deriveServiceWindowDto(
  record: MessagingPolicyRecord,
  now: Date,
): ServiceWindowDto {
  const window = calculateServiceWindow(record.lastCustomerMessageAt, now);
  const base = {
    enforcement: record.enforcement,
    status: window.status,
    closesAt: window.closesAt?.toISOString() ?? null,
  } as const;

  if (record.enforcement === "INACTIVE") {
    return { ...base, sendMode: "FREE_FORM", reason: null, resumption: null };
  }
  if (record.messagingOptOutAt) {
    return {
      ...base,
      sendMode: "BLOCKED",
      reason: "CONTACT_OPTED_OUT",
      resumption: null,
    };
  }
  if (window.status === "OPEN") {
    return { ...base, sendMode: "FREE_FORM", reason: null, resumption: null };
  }
  if (record.confirmingResumption) {
    return {
      ...base,
      sendMode: "CONFIRMING",
      reason: null,
      resumption: null,
    };
  }
  if (record.awaitingCustomerSince) {
    return {
      ...base,
      sendMode: "AWAITING_CUSTOMER",
      reason: null,
      resumption: null,
    };
  }
  if (!record.lastCustomerMessageAt) {
    return {
      ...base,
      sendMode: "BLOCKED",
      reason: "NO_CUSTOMER_MESSAGE",
      resumption: null,
    };
  }
  if (!record.pendingCustomerMessageId) {
    return {
      ...base,
      sendMode: "BLOCKED",
      reason: "NO_PENDING_REQUEST",
      resumption: null,
    };
  }
  if (!record.resumptionTemplate) {
    return {
      ...base,
      sendMode: "BLOCKED",
      reason: "TEMPLATE_UNAVAILABLE",
      resumption: null,
    };
  }

  return {
    ...base,
    sendMode: "RESUMPTION",
    reason: null,
    resumption: record.resumptionTemplate,
  };
}

export async function getMessagingPolicySnapshot(
  conversationId: string,
  now: Date = new Date(),
  repository: MessagingPolicyRepository = prismaMessagingPolicyRepository,
): Promise<ServiceWindowDto> {
  const record = await repository.findPolicyRecord(conversationId, now);
  if (!record) {
    throw new HttpError(404, "Conversa não encontrada");
  }

  return deriveServiceWindowDto(record, now);
}

export async function assertFreeFormSendAllowed(
  conversationId: string,
  now: Date = new Date(),
  repository: MessagingPolicyRepository = prismaMessagingPolicyRepository,
): Promise<void> {
  const snapshot = await getMessagingPolicySnapshot(
    conversationId,
    now,
    repository,
  );
  if (
    snapshot.enforcement === "ACTIVE" &&
    snapshot.reason === "CONTACT_OPTED_OUT"
  ) {
    throw new HttpError(
      409,
      "Este contato está marcado como não contatar.",
      "WHATSAPP_CONTACT_OPTED_OUT",
    );
  }
  if (snapshot.enforcement === "ACTIVE" && snapshot.status === "CLOSED") {
    throw new HttpError(
      409,
      "A janela de atendimento terminou. Aguarde o cliente responder ou retome com o modelo aprovado.",
      "WHATSAPP_SERVICE_WINDOW_CLOSED",
    );
  }
}
