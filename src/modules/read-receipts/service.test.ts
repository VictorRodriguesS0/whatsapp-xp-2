// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import { WhatsAppProviderError } from "@/modules/whatsapp/meta-provider";

import {
  deliverReadReceiptForConversation,
  retryDelayMs,
  type ReadReceiptServiceDependencies,
} from "./service";
import type { ReadReceiptClaim, ReadReceiptRepository } from "./types";

const now = new Date("2026-08-23T12:00:00.000Z");
const claim: ReadReceiptClaim = {
  conversationId: "32000000-0000-4000-8000-000000000001",
  targetMessageId: "32000000-0000-4000-8000-000000000002",
  whatsappMessageId: "wamid.inbound-1",
  externalTimestamp: new Date("2026-08-23T11:59:00.000Z"),
  attemptCount: 1,
  leaseId: "32000000-0000-4000-8000-000000000003",
};

function harness() {
  const repository: ReadReceiptRepository = {
    claimConversation: vi.fn(async () => claim),
    claimNextDue: vi.fn(async () => claim),
    confirm: vi.fn(async () => undefined),
    fail: vi.fn(async () => undefined),
  };
  const provider = { markRead: vi.fn(async () => undefined) };
  const dependencies: ReadReceiptServiceDependencies = {
    repository,
    provider,
    now: () => now,
    createUuid: () => "32000000-0000-4000-8000-000000000003",
  };
  return { dependencies, provider, repository };
}

describe("WhatsApp read receipt delivery", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the approved bounded retry schedule", () => {
    expect([1, 2, 3, 4, 5, 6, 20].map(retryDelayMs)).toEqual([
      2_000,
      10_000,
      30_000,
      120_000,
      600_000,
      1_800_000,
      1_800_000,
    ]);
  });

  it("confirms an accepted provider receipt", async () => {
    const { dependencies, provider, repository } = harness();

    await expect(
      deliverReadReceiptForConversation(claim.conversationId, dependencies),
    ).resolves.toBe("CONFIRMED");
    expect(provider.markRead).toHaveBeenCalledWith({
      messageId: claim.whatsappMessageId,
    });
    expect(repository.confirm).toHaveBeenCalledWith(claim, now);
  });

  it("keeps local success pending after an unknown provider result", async () => {
    const { dependencies, provider, repository } = harness();
    provider.markRead.mockRejectedValue(new WhatsAppProviderError("unknown"));

    await expect(
      deliverReadReceiptForConversation(claim.conversationId, dependencies),
    ).resolves.toBe("PENDING");
    expect(repository.fail).toHaveBeenCalledWith(claim, {
      kind: "TRANSIENT",
      nextAttemptAt: new Date(now.getTime() + 2_000),
    });
  });

  it("blocks only the rejected target", async () => {
    const { dependencies, provider, repository } = harness();
    provider.markRead.mockRejectedValue(new WhatsAppProviderError("rejected"));

    await expect(
      deliverReadReceiptForConversation(claim.conversationId, dependencies),
    ).resolves.toBe("PENDING");
    expect(repository.fail).toHaveBeenCalledWith(claim, {
      kind: "REJECTED",
      nextAttemptAt: null,
    });
  });

  it("does nothing when no eligible target is due", async () => {
    const { dependencies, provider, repository } = harness();
    vi.mocked(repository.claimConversation).mockResolvedValue(null);

    await expect(
      deliverReadReceiptForConversation(claim.conversationId, dependencies),
    ).resolves.toBe("NOT_APPLICABLE");
    expect(provider.markRead).not.toHaveBeenCalled();
  });
});
