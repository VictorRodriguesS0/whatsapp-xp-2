import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { WhatsAppProviderError } from "@/modules/whatsapp/meta-provider";

import {
  retryBusinessReaction,
  setBusinessReaction,
  type ReactionServiceDependencies,
} from "./service";
import type {
  BusinessReactionRecord,
  BeginBusinessReactionResult,
  ReactionTargetRecord,
} from "./types";

const actor = { id: "10000000-0000-4000-8000-000000000001", name: "Ana" };
const messageId = "20000000-0000-4000-8000-000000000001";
const reactionId = "30000000-0000-4000-8000-000000000001";
const now = new Date("2026-08-22T15:00:00.000Z");

function reaction(overrides: Partial<BusinessReactionRecord> = {}): BusinessReactionRecord {
  return {
    id: reactionId,
    messageId,
    emoji: "👍",
    status: "SENT",
    clientRequestId: randomUUID(),
    providerMessageId: "wamid.reaction",
    providerAttemptedAt: now,
    sentByUser: actor,
    failureReason: null,
    ...overrides,
  };
}

class FakeRepository {
  activeUser: { id: string; name: string } | null = actor;
  target: ReactionTargetRecord | null = {
    messageId,
    conversationId: "40000000-0000-4000-8000-000000000001",
    contactPhone: "5561999999999",
    whatsappMessageId: "wamid.target",
    externalTimestamp: new Date("2026-08-01T15:00:00.000Z"),
    revokedAt: null,
    isReactionMessage: false,
  };
  current: BusinessReactionRecord | null = null;
  beginCalls = 0;

  async findActiveUser(userId: string) {
    return this.activeUser?.id === userId ? this.activeUser : null;
  }

  async findTarget(id: string) {
    return this.target?.messageId === id ? this.target : null;
  }

  async beginBusinessReaction(input: {
    messageId: string;
    actorId: string;
    actorName: string;
    requestedEmoji: string;
    clientRequestId: string;
  }): Promise<BeginBusinessReactionResult> {
    this.beginCalls += 1;
    if (this.current?.clientRequestId === input.clientRequestId) {
      return { kind: "EXISTING", reaction: this.current };
    }
    if (this.current?.status === "PENDING") {
      return { kind: "BUSY", reaction: this.current };
    }
    const providerEmoji =
      this.current?.status === "SENT" && this.current.emoji === input.requestedEmoji
        ? ""
        : input.requestedEmoji;
    this.current = reaction({
      emoji: providerEmoji,
      status: "PENDING",
      clientRequestId: input.clientRequestId,
      providerMessageId: null,
      providerAttemptedAt: null,
      sentByUser: { id: input.actorId, name: input.actorName },
      failureReason: null,
    });
    return { kind: "STARTED", reaction: this.current, providerEmoji };
  }

  async markProviderAttempt(id: string, clientRequestId: string, attemptedAt: Date) {
    if (this.current?.id !== id || this.current.clientRequestId !== clientRequestId) return false;
    this.current = { ...this.current, providerAttemptedAt: attemptedAt };
    return true;
  }

  async markSent(id: string, clientRequestId: string, providerMessageId: string) {
    if (this.current?.id !== id || this.current.clientRequestId !== clientRequestId) return null;
    this.current = { ...this.current, status: "SENT", providerMessageId };
    return this.current;
  }

  async markFailed(id: string, clientRequestId: string, status: "FAILED" | "OUTCOME_UNKNOWN", reason: string | null) {
    if (this.current?.id !== id || this.current.clientRequestId !== clientRequestId) return null;
    this.current = { ...this.current, status, failureReason: reason };
    return this.current;
  }

  async confirmRemoval(id: string, clientRequestId: string) {
    if (this.current?.id !== id || this.current.clientRequestId !== clientRequestId) return false;
    this.current = null;
    return true;
  }

  async findBusinessReactionById(id: string) {
    return this.current?.id === id ? this.current : null;
  }
}

function setup() {
  const repository = new FakeRepository();
  const provider = {
    sendReaction: vi.fn(async () => ({ whatsappMessageId: "wamid.sent", status: "SENT" as const })),
  };
  const dependencies: ReactionServiceDependencies = {
    repository,
    provider,
    now: () => now,
    inFlight: new Map(),
  };
  return { repository, provider, dependencies };
}

describe("setBusinessReaction", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("persists and sends a business reaction", async () => {
    const state = setup();
    const clientRequestId = randomUUID();

    await expect(
      setBusinessReaction(actor.id, messageId, { emoji: "👍", clientRequestId }, state.dependencies),
    ).resolves.toMatchObject({
      id: reactionId,
      messageId,
      reactor: "BUSINESS",
      emoji: "👍",
      status: "SENT",
      removed: false,
      sentBy: actor,
    });
    expect(state.provider.sendReaction).toHaveBeenCalledOnce();
    expect(state.provider.sendReaction).toHaveBeenCalledWith({
      to: "5561999999999",
      targetWhatsappMessageId: "wamid.target",
      emoji: "👍",
    });
  });

  it("uses the same emoji as a removal toggle and deletes only after confirmation", async () => {
    const state = setup();
    state.repository.current = reaction({ emoji: "❤️" });

    const result = await setBusinessReaction(
      actor.id,
      messageId,
      { emoji: "❤️", clientRequestId: randomUUID() },
      state.dependencies,
    );

    expect(state.provider.sendReaction).toHaveBeenCalledWith(expect.objectContaining({ emoji: "" }));
    expect(result).toMatchObject({ messageId, emoji: "", status: "SENT", removed: true });
    expect(state.repository.current).toBeNull();
  });

  it("supports an explicit empty-string removal command", async () => {
    const state = setup();
    state.repository.current = reaction({ emoji: "😂" });
    await setBusinessReaction(
      actor.id,
      messageId,
      { emoji: "", clientRequestId: randomUUID() },
      state.dependencies,
    );
    expect(state.provider.sendReaction).toHaveBeenCalledWith(expect.objectContaining({ emoji: "" }));
  });

  it("deduplicates concurrent requests by clientRequestId", async () => {
    const state = setup();
    const clientRequestId = randomUUID();
    let release!: () => void;
    state.provider.sendReaction.mockImplementationOnce(
      () => new Promise((resolve) => {
        release = () => resolve({ whatsappMessageId: "wamid.sent", status: "SENT" });
      }),
    );
    const first = setBusinessReaction(actor.id, messageId, { emoji: "🙏", clientRequestId }, state.dependencies);
    const second = setBusinessReaction(actor.id, messageId, { emoji: "🙏", clientRequestId }, state.dependencies);
    await vi.waitFor(() => expect(state.provider.sendReaction).toHaveBeenCalledOnce());
    release();

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(state.provider.sendReaction).toHaveBeenCalledOnce();
    expect(state.repository.beginCalls).toBe(1);
  });

  it.each([
    ["inactive user", (state: ReturnType<typeof setup>) => { state.repository.activeUser = null; }, 403],
    ["missing message", (state: ReturnType<typeof setup>) => { state.repository.target = null; }, 404],
    ["missing wamid", (state: ReturnType<typeof setup>) => { state.repository.target!.whatsappMessageId = null; }, 409],
    ["older than 30 days", (state: ReturnType<typeof setup>) => { state.repository.target!.externalTimestamp = new Date("2026-07-23T14:59:59.999Z"); }, 409],
    ["revoked message", (state: ReturnType<typeof setup>) => { state.repository.target!.revokedAt = now; }, 409],
    ["reaction message", (state: ReturnType<typeof setup>) => { state.repository.target!.isReactionMessage = true; }, 409],
  ])("rejects an ineligible target: %s", async (_label, mutate, status) => {
    const state = setup();
    mutate(state);
    const promise = setBusinessReaction(
      actor.id,
      messageId,
      { emoji: "👍", clientRequestId: randomUUID() },
      state.dependencies,
    );
    await expect(promise).rejects.toMatchObject({ status });
    expect(state.provider.sendReaction).not.toHaveBeenCalled();
  });

  it("accepts a message exactly 30 days old", async () => {
    const state = setup();
    state.repository.target!.externalTimestamp = new Date("2026-07-23T15:00:00.000Z");
    await expect(
      setBusinessReaction(actor.id, messageId, { emoji: "👍", clientRequestId: randomUUID() }, state.dependencies),
    ).resolves.toMatchObject({ status: "SENT" });
  });

  it("records a confirmed rejection without leaking provider details", async () => {
    const state = setup();
    state.provider.sendReaction.mockRejectedValueOnce(
      new WhatsAppProviderError("rejected", "secret provider body"),
    );
    const result = await setBusinessReaction(
      actor.id,
      messageId,
      { emoji: "👍", clientRequestId: randomUUID() },
      state.dependencies,
    );
    expect(result).toMatchObject({ status: "FAILED", removed: false });
    expect(result).not.toHaveProperty("failureReason");
    expect(state.repository.current?.failureReason).not.toContain("secret provider body");
  });

  it("records an unknown provider outcome and does not blindly retry", async () => {
    const state = setup();
    state.provider.sendReaction.mockRejectedValueOnce(new WhatsAppProviderError("unknown"));
    const clientRequestId = randomUUID();
    const first = await setBusinessReaction(
      actor.id,
      messageId,
      { emoji: "👍", clientRequestId },
      state.dependencies,
    );
    const repeated = await setBusinessReaction(
      actor.id,
      messageId,
      { emoji: "👍", clientRequestId },
      state.dependencies,
    );
    expect(first).toMatchObject({ status: "OUTCOME_UNKNOWN" });
    expect(repeated).toEqual(first);
    expect(state.provider.sendReaction).toHaveBeenCalledOnce();
  });
});

describe("retryBusinessReaction", () => {
  it("manually retries a failed reaction with a new request id", async () => {
    const state = setup();
    state.repository.current = reaction({ status: "FAILED", failureReason: "Falha no envio" });
    const clientRequestId = randomUUID();

    await expect(
      retryBusinessReaction(actor.id, reactionId, { clientRequestId }, state.dependencies),
    ).resolves.toMatchObject({ emoji: "👍", status: "SENT" });
    expect(state.provider.sendReaction).toHaveBeenCalledOnce();
  });
});
