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
