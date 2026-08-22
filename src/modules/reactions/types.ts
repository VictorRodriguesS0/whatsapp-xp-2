import type { ReactionStatus } from "@/generated/prisma/enums";

export type ActiveReactionUser = {
  id: string;
  name: string;
};

export type ReactionTargetRecord = {
  messageId: string;
  conversationId: string;
  contactPhone: string;
  whatsappMessageId: string | null;
  externalTimestamp: Date;
  revokedAt: Date | null;
  isReactionMessage: boolean;
};

export type BusinessReactionRecord = {
  id: string;
  messageId: string;
  emoji: string;
  status: ReactionStatus;
  clientRequestId: string;
  providerMessageId: string | null;
  providerAttemptedAt: Date | null;
  sentByUser: ActiveReactionUser;
  failureReason: string | null;
};

export type BeginBusinessReactionResult =
  | { kind: "STARTED"; reaction: BusinessReactionRecord; providerEmoji: string }
  | { kind: "EXISTING"; reaction: BusinessReactionRecord }
  | { kind: "BUSY"; reaction: BusinessReactionRecord };

export type BeginBusinessReactionInput = {
  messageId: string;
  actorId: string;
  actorName: string;
  requestedEmoji: string;
  clientRequestId: string;
};

export interface ReactionRepository {
  findActiveUser(userId: string): Promise<ActiveReactionUser | null>;
  findTarget(messageId: string): Promise<ReactionTargetRecord | null>;
  beginBusinessReaction(input: BeginBusinessReactionInput): Promise<BeginBusinessReactionResult>;
  markProviderAttempt(reactionId: string, clientRequestId: string, attemptedAt: Date): Promise<boolean>;
  markSent(reactionId: string, clientRequestId: string, providerMessageId: string): Promise<BusinessReactionRecord | null>;
  markFailed(
    reactionId: string,
    clientRequestId: string,
    status: Extract<ReactionStatus, "FAILED" | "OUTCOME_UNKNOWN">,
    failureReason: string | null,
  ): Promise<BusinessReactionRecord | null>;
  confirmRemoval(reactionId: string, clientRequestId: string): Promise<boolean>;
  findBusinessReactionById(reactionId: string): Promise<BusinessReactionRecord | null>;
}

export interface ReactionProvider {
  sendReaction(input: {
    to: string;
    targetWhatsappMessageId: string;
    emoji: string;
  }): Promise<{ whatsappMessageId: string; status: "SENT" }>;
}

export type ReactionMutationDto = {
  id: string;
  messageId: string;
  reactor: "BUSINESS";
  emoji: string;
  status: ReactionStatus;
  removed: boolean;
  sentBy: ActiveReactionUser;
};
