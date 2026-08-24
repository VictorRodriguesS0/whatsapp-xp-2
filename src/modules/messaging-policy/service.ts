import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import {
  WhatsAppPolicyMode,
  WhatsAppTemplateFunction,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/http";

import type {
  ServiceWindowCalculation,
  ServiceWindowDto,
} from "./types";

export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1_000;

export type MessagingPolicyRecord = {
  enforcement: "INACTIVE" | "ACTIVE";
  lastCustomerMessageAt: Date | null;
  pendingCustomerMessageId: string | null;
  awaitingCustomerSince: Date | null;
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
  ): Promise<MessagingPolicyRecord | null>;
};

type MessagingPolicyPrismaClient = Pick<
  PrismaClient,
  "conversation" | "whatsAppPolicyConfiguration" | "whatsAppTemplateAssignment"
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

export function createPrismaMessagingPolicyRepository(
  client: MessagingPolicyPrismaClient,
): MessagingPolicyRepository {
  return {
    async findPolicyRecord(conversationId) {
      const [configuration, conversation, assignment] = await Promise.all([
        client.whatsAppPolicyConfiguration.findUnique({
          where: { id: 1 },
          select: { mode: true },
        }),
        client.conversation.findUnique({
          where: { id: conversationId },
          select: {
            lastCustomerMessageAt: true,
            pendingCustomerMessageId: true,
            awaitingCustomerSince: true,
            contact: { select: { messagingOptOutAt: true } },
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
              },
            },
          },
        }),
      ]);

      if (!conversation) {
        return null;
      }

      const template = assignment?.template;
      const eligibleTemplate =
        template?.status === "APPROVED" &&
        template.supported &&
        template.language === "pt_BR"
          ? {
              templateName: template.name,
              language: template.language,
              previewBody: template.bodyText,
            }
          : null;

      return {
        enforcement:
          configuration?.mode === WhatsAppPolicyMode.ACTIVE
            ? "ACTIVE"
            : "INACTIVE",
        lastCustomerMessageAt: conversation.lastCustomerMessageAt,
        pendingCustomerMessageId: conversation.pendingCustomerMessageId,
        awaitingCustomerSince: conversation.awaitingCustomerSince,
        messagingOptOutAt: conversation.contact.messagingOptOutAt,
        resumptionTemplate: eligibleTemplate,
      };
    },
  };
}

const prismaMessagingPolicyRepository = createPrismaMessagingPolicyRepository(
  prisma,
);

export async function getMessagingPolicySnapshot(
  conversationId: string,
  now: Date = new Date(),
  repository: MessagingPolicyRepository = prismaMessagingPolicyRepository,
): Promise<ServiceWindowDto> {
  const record = await repository.findPolicyRecord(conversationId);
  if (!record) {
    throw new HttpError(404, "Conversa não encontrada");
  }

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
