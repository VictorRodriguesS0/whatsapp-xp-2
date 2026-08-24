import type {
  ConversationResumptionStatus,
  MessageOperationalState,
  MessageStatus,
  WhatsAppPolicyMode,
} from "@/generated/prisma/enums";
import type { SessionUser } from "@/modules/auth/session";
import type {
  MessageServiceRecord,
  PreparedTemplateMessageInput,
} from "@/modules/messages/service";
import type { RealtimeEvent } from "@/modules/realtime/events";

export type ResumptionActor = SessionUser;

export type ResumptionTemplateRecord = {
  id: string;
  name: string;
  language: string;
  status: string;
  supported: boolean;
  parameterCount: number;
  definitionHash: string;
  bodyText: string;
  syncedAt: Date;
};

export type ResumptionEligibilityRecord = {
  conversationId: string;
  pendingCustomerMessageId: string | null;
  lastCustomerMessageAt: Date | null;
  awaitingCustomerSince: Date | null;
  messagingOptOutAt: Date | null;
  resolvedContactName: string | null;
  policyMode: WhatsAppPolicyMode;
  lastTemplateSyncStatus: "NEVER" | "SUCCEEDED" | "FAILED";
  lastTemplateSyncSucceededAt: Date | null;
  template: ResumptionTemplateRecord | null;
};

export type ResumptionAttemptMessage = {
  id: string;
  status: MessageStatus;
  operationalState: MessageOperationalState;
  providerAttemptedAt: Date | null;
  whatsappMessageId: string | null;
};

export type ResumptionRecord = {
  id: string;
  conversationId: string;
  sourceMessageId: string;
  templateId: string;
  messageId: string | null;
  sentByUserId: string;
  clientRequestId: string;
  status: ConversationResumptionStatus;
  renderedBody: string;
  templateName: string;
  templateLanguage: string;
  definitionHash: string;
  parameters: unknown;
  providerMessageId: string | null;
  providerAttemptedAt: Date | null;
  reservationUntil: Date | null;
  failureReason: string | null;
};

export type CreateResumptionReservation = Omit<
  ResumptionRecord,
  | "messageId"
  | "status"
  | "providerMessageId"
  | "providerAttemptedAt"
  | "failureReason"
>;

export type FinalizeResumptionInput = {
  id: string;
  status: Extract<
    ConversationResumptionStatus,
    "SENT" | "FAILED" | "OUTCOME_UNKNOWN"
  >;
  messageId: string | null;
  providerMessageId: string | null;
  providerAttemptedAt: Date | null;
  failureReason: string | null;
  finalizedAt: Date;
};

export type ResumptionRepository = {
  transaction<T>(
    operation: (repository: ResumptionRepository) => Promise<T>,
  ): Promise<T>;
  lockConversationAndPolicy(conversationId: string): Promise<void>;
  isActorActive(actorUserId: string): Promise<boolean>;
  getEligibility(
    conversationId: string,
  ): Promise<ResumptionEligibilityRecord | null>;
  findByClientRequestId(
    clientRequestId: string,
  ): Promise<ResumptionRecord | null>;
  findActiveBySource(sourceMessageId: string): Promise<ResumptionRecord | null>;
  findAttemptMessage(
    clientRequestId: string,
    messageId: string | null,
  ): Promise<ResumptionAttemptMessage | null>;
  expireReservation(id: string, reason: string): Promise<void>;
  createReservation(
    input: CreateResumptionReservation,
  ): Promise<ResumptionRecord>;
  finalize(input: FinalizeResumptionInput): Promise<ResumptionRecord>;
};

export type ResumptionResultDto = {
  id: string;
  clientRequestId: string;
  status: "RESERVED" | "SENT" | "FAILED" | "OUTCOME_UNKNOWN";
  messageId: string | null;
};

export type ResumptionServiceDependencies = {
  repository: ResumptionRepository;
  now(): Date;
  createUuid(): string;
  reservationMs: number;
  sendPreparedTemplateMessage(
    actor: SessionUser,
    conversationId: string,
    input: PreparedTemplateMessageInput,
  ): Promise<MessageServiceRecord>;
  publishRealtime(event: RealtimeEvent): void;
};
