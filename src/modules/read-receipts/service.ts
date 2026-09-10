import "server-only";

import { randomUUID } from "node:crypto";

import { ReadReceiptFailureKind } from "@/generated/prisma/enums";
import { getWhatsAppProvider } from "@/modules/whatsapp/factory";
import { WhatsAppProviderError } from "@/modules/whatsapp/meta-provider";
import type { WhatsAppProvider } from "@/modules/whatsapp/provider";

import { prismaReadReceiptRepository } from "./repository";
import type {
  ReadReceiptClaim,
  ReadReceiptDelivery,
  ReadReceiptRepository,
} from "./types";

const LEASE_MS = 30_000;
const RETRY_DELAYS_MS = [2_000, 10_000, 30_000, 120_000, 600_000] as const;

export function retryDelayMs(attemptCount: number): number {
  if (attemptCount > RETRY_DELAYS_MS.length) return 1_800_000;
  return RETRY_DELAYS_MS[Math.max(attemptCount, 1) - 1] ?? 2_000;
}

export type ReadReceiptServiceDependencies = {
  repository: ReadReceiptRepository;
  provider: Pick<WhatsAppProvider, "markRead">;
  now?: () => Date;
  createUuid?: () => string;
  leaseMs?: number;
};

function defaultDependencies(): ReadReceiptServiceDependencies {
  return {
    repository: prismaReadReceiptRepository,
    provider: getWhatsAppProvider(),
  };
}

async function deliverClaim(
  claim: ReadReceiptClaim,
  dependencies: ReadReceiptServiceDependencies,
): Promise<ReadReceiptDelivery> {
  const clock = dependencies.now ?? (() => new Date());
  try {
    await dependencies.provider.markRead({ messageId: claim.whatsappMessageId });
    await dependencies.repository.confirm(claim, clock());
    return "CONFIRMED";
  } catch (error) {
    const locallyHeld = error instanceof WhatsAppProviderError && error.graphCode === "LOCAL_CONNECTION_UNAVAILABLE";
    const rejected =
      error instanceof WhatsAppProviderError && error.kind === "rejected" && !locallyHeld;
    const failedAt = clock();
    await dependencies.repository.fail(claim, {
      kind: rejected
        ? ReadReceiptFailureKind.REJECTED
        : ReadReceiptFailureKind.TRANSIENT,
      nextAttemptAt: rejected
        ? null
        : new Date(failedAt.getTime() + Math.max(locallyHeld ? 60_000 : 0, retryDelayMs(claim.attemptCount))),
    });
    return "PENDING";
  }
}

function claimInput(dependencies: ReadReceiptServiceDependencies) {
  const now = (dependencies.now ?? (() => new Date()))();
  return {
    now,
    leaseId: (dependencies.createUuid ?? randomUUID)(),
    leaseUntil: new Date(
      now.getTime() + (dependencies.leaseMs ?? LEASE_MS),
    ),
  };
}

export async function deliverReadReceiptForConversation(
  conversationId: string,
  dependencies: ReadReceiptServiceDependencies = defaultDependencies(),
): Promise<ReadReceiptDelivery> {
  const claim = await dependencies.repository.claimConversation({
    conversationId,
    ...claimInput(dependencies),
  });
  return claim ? deliverClaim(claim, dependencies) : "NOT_APPLICABLE";
}

export async function processNextDueReadReceipt(
  dependencies: ReadReceiptServiceDependencies = defaultDependencies(),
): Promise<boolean> {
  const claim = await dependencies.repository.claimNextDue(
    claimInput(dependencies),
  );
  if (!claim) return false;
  await deliverClaim(claim, dependencies);
  return true;
}
