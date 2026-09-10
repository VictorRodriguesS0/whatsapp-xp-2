// @vitest-environment node

import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { MessageDirection, MessageStatus, MessageType } from "@/generated/prisma/enums";
import { HttpError } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resetTestDatabase, seedReadFixture } from "@/test/database";

import { prismaReactionRepository } from "./repository";
import { setBusinessReaction, type ReactionServiceDependencies } from "./service";

const now = new Date("2026-08-22T15:00:00.000Z");

async function seedTarget() {
  const { conversation, victor } = await seedReadFixture();
  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      whatsappMessageId: `wamid.target-${randomUUID()}`,
      direction: MessageDirection.INBOUND,
      type: MessageType.TEXT,
      body: "Mensagem para reagir",
      status: MessageStatus.RECEIVED,
      externalTimestamp: new Date("2026-08-21T15:00:00.000Z"),
    },
  });
  return { conversation, victor, message };
}

function dependencies(provider = {
  sendReaction: vi.fn(async () => ({ whatsappMessageId: `wamid.reaction-${randomUUID()}`, status: "SENT" as const })),
}) {
  return {
    repository: prismaReactionRepository,
    provider,
    now: () => now,
    inFlight: new Map(),
  } satisfies ReactionServiceDependencies;
}

describe("reaction service with PostgreSQL", () => {
  beforeEach(resetTestDatabase);

  it("persists one business reaction without changing shared read or response state", async () => {
    const { conversation, victor, message } = await seedTarget();
    const awaitingResponseSince = new Date("2026-08-21T14:00:00.000Z");
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { awaitingResponseSince },
    });
    await prisma.conversationRead.create({
      data: {
        conversationId: conversation.id,
        userId: victor.id,
        lastReadAt: new Date("2026-08-21T13:00:00.000Z"),
      },
    });
    const readsBefore = await prisma.conversationRead.findMany();

    const result = await setBusinessReaction(
      victor.id,
      message.id,
      { emoji: "👍", clientRequestId: randomUUID() },
      dependencies(),
    );

    expect(result).toMatchObject({ messageId: message.id, emoji: "👍", status: "SENT" });
    await expect(prisma.messageReaction.findMany()).resolves.toEqual([
      expect.objectContaining({
        messageId: message.id,
        reactor: "BUSINESS",
        emoji: "👍",
        status: "SENT",
        sentByUserId: victor.id,
      }),
    ]);
    await expect(
      prisma.conversation.findUniqueOrThrow({
        where: { id: conversation.id },
        select: { awaitingResponseSince: true },
      }),
    ).resolves.toEqual({ awaitingResponseSince });
    await expect(prisma.conversationRead.findMany()).resolves.toEqual(readsBefore);
  });

  it("does not call the provider again for the same client request id", async () => {
    const { victor, message } = await seedTarget();
    const provider = {
      sendReaction: vi.fn(async () => ({ whatsappMessageId: "wamid.sent", status: "SENT" as const })),
    };
    const deps = dependencies(provider);
    const clientRequestId = randomUUID();

    const first = await setBusinessReaction(
      victor.id,
      message.id,
      { emoji: "❤️", clientRequestId },
      deps,
    );
    const repeated = await setBusinessReaction(
      victor.id,
      message.id,
      { emoji: "❤️", clientRequestId },
      deps,
    );

    expect(repeated).toEqual(first);
    expect(provider.sendReaction).toHaveBeenCalledOnce();
    await expect(prisma.messageReaction.count()).resolves.toBe(1);
  });

  it("removes the local current reaction only after provider confirmation", async () => {
    const { victor, message } = await seedTarget();
    const deps = dependencies();
    await setBusinessReaction(
      victor.id,
      message.id,
      { emoji: "😂", clientRequestId: randomUUID() },
      deps,
    );
    const removed = await setBusinessReaction(
      victor.id,
      message.id,
      { emoji: "😂", clientRequestId: randomUUID() },
      deps,
    );

    expect(removed).toMatchObject({ emoji: "", status: "SENT", removed: true });
    await expect(prisma.messageReaction.findFirst()).resolves.toMatchObject({
      emoji: "",
      status: "SENT",
    });
  });

  it("allows only one provider operation per target message", async () => {
    const { victor, message } = await seedTarget();
    let release!: () => void;
    const provider = {
      sendReaction: vi.fn(
        () => new Promise<{ whatsappMessageId: string; status: "SENT" }>((resolve) => {
          release = () => resolve({ whatsappMessageId: "wamid.sent", status: "SENT" });
        }),
      ),
    };
    const deps = dependencies(provider);
    const first = setBusinessReaction(
      victor.id,
      message.id,
      { emoji: "👍", clientRequestId: randomUUID() },
      deps,
    );
    await vi.waitFor(() => expect(provider.sendReaction).toHaveBeenCalledOnce());
    const competing = setBusinessReaction(
      victor.id,
      message.id,
      { emoji: "🙏", clientRequestId: randomUUID() },
      deps,
    );
    await expect(competing).rejects.toMatchObject({ status: 409 });
    release();
    await expect(first).resolves.toMatchObject({ emoji: "👍", status: "SENT" });
    expect(provider.sendReaction).toHaveBeenCalledOnce();
  });
  it("releases a reaction when the connection disappears before the provider attempt", async () => {
    const { victor, message } = await seedTarget();
    const deps = dependencies();
    const guard = vi.fn<() => Promise<void>>().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new HttpError(503, "Disconnected", "META_DISCONNECTED"));
    await expect(setBusinessReaction(victor.id, message.id, { emoji: "👍", clientRequestId: randomUUID() }, { ...deps, assertConnectionSendAllowed: guard })).rejects.toMatchObject({ status: 503 });
    expect(deps.provider.sendReaction).not.toHaveBeenCalled();
    expect(await prisma.messageReaction.findFirst()).toMatchObject({ status: "FAILED", providerAttemptedAt: null });
    await expect(setBusinessReaction(victor.id, message.id, { emoji: "👍", clientRequestId: randomUUID() }, deps)).resolves.toMatchObject({ status: "SENT" });
  });

});
