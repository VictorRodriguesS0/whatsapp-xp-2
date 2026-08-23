import type { Prisma } from "@/generated/prisma/client";
import type { ReadReceiptFailureKind } from "@/generated/prisma/enums";

export type ReadBoundary = { id: string; externalTimestamp: Date };
export type ReadSyncClient = Prisma.TransactionClient;
export type ReadReceiptDelivery =
  | "CONFIRMED"
  | "PENDING"
  | "NOT_APPLICABLE";

export type ReadReceiptClaim = {
  conversationId: string;
  targetMessageId: string;
  whatsappMessageId: string;
  externalTimestamp: Date;
  attemptCount: number;
  leaseId: string;
};

export type ReadReceiptFailure = {
  kind: ReadReceiptFailureKind;
  nextAttemptAt: Date | null;
};

export interface ReadReceiptRepository {
  claimConversation(input: {
    conversationId: string;
    now: Date;
    leaseId: string;
    leaseUntil: Date;
  }): Promise<ReadReceiptClaim | null>;
  claimNextDue(input: {
    now: Date;
    leaseId: string;
    leaseUntil: Date;
  }): Promise<ReadReceiptClaim | null>;
  confirm(claim: ReadReceiptClaim, confirmedAt: Date): Promise<void>;
  fail(claim: ReadReceiptClaim, failure: ReadReceiptFailure): Promise<void>;
}
