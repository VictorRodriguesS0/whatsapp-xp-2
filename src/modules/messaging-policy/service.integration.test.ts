// @vitest-environment node

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  MessageDirection,
  MessageStatus,
  MessageType,
  WhatsAppPolicyMode,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { refreshResponseState } from "@/modules/conversations/shared-state";
import { resetTestDatabase, seedReadFixture } from "@/test/database";

import {
  assertFreeFormSendAllowed,
  getMessagingPolicySnapshot,
} from "./service";

describe("WhatsApp messaging policy in PostgreSQL", () => {
  beforeEach(resetTestDatabase);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("enforces the exact boundary only after policy activation", async () => {
    const { conversation, victor } = await seedReadFixture();
    const receivedAt = new Date("2026-08-22T12:00:00.000Z");
    const inbound = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: MessageDirection.INBOUND,
        type: MessageType.TEXT,
        body: "Preciso de ajuda",
        status: MessageStatus.RECEIVED,
        externalTimestamp: receivedAt,
      },
    });
    await refreshResponseState(prisma, conversation.id);

    await expect(
      assertFreeFormSendAllowed(
        conversation.id,
        new Date("2026-08-23T12:00:00.000Z"),
      ),
    ).resolves.toBeUndefined();

    await prisma.whatsAppPolicyConfiguration.update({
      where: { id: 1 },
      data: {
        mode: WhatsAppPolicyMode.ACTIVE,
        activatedAt: new Date("2026-08-23T11:00:00.000Z"),
        activatedByUserId: victor.id,
        version: { increment: 1 },
      },
    });

    await expect(
      assertFreeFormSendAllowed(
        conversation.id,
        new Date("2026-08-23T11:59:59.999Z"),
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertFreeFormSendAllowed(
        conversation.id,
        new Date("2026-08-23T12:00:00.000Z"),
      ),
    ).rejects.toMatchObject({
      status: 409,
      code: "WHATSAPP_SERVICE_WINDOW_CLOSED",
    });

    const snapshot = await getMessagingPolicySnapshot(
      conversation.id,
      new Date("2026-08-23T12:00:00.000Z"),
    );
    expect(snapshot).toMatchObject({
      enforcement: "ACTIVE",
      status: "CLOSED",
      sendMode: "BLOCKED",
      reason: "TEMPLATE_UNAVAILABLE",
    });
    expect(JSON.stringify(snapshot)).not.toContain(inbound.id);
  });
});
