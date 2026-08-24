// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  assertFreeFormSendAllowed,
  calculateServiceWindow,
  getMessagingPolicySnapshot,
  type MessagingPolicyRepository,
} from "./service";

const conversationId = "50000000-0000-4000-8000-000000000001";
const now = new Date("2026-08-23T12:00:00.000Z");

function repository(
  overrides: Partial<Awaited<ReturnType<MessagingPolicyRepository["findPolicyRecord"]>>> = {},
): MessagingPolicyRepository {
  return {
    findPolicyRecord: async () => ({
      enforcement: "ACTIVE",
      lastCustomerMessageAt: new Date("2026-08-22T12:00:00.001Z"),
      pendingCustomerMessageId: "50000000-0000-4000-8000-000000000002",
      awaitingCustomerSince: null,
      messagingOptOutAt: null,
      resumptionTemplate: null,
      ...overrides,
    }),
  };
}

describe("WhatsApp service-window policy", () => {
  it("closes a conversation with no customer message", () => {
    expect(calculateServiceWindow(null, now)).toEqual({
      status: "CLOSED",
      closesAt: null,
    });
  });

  it("is open one millisecond before the 24-hour boundary", () => {
    const lastCustomerMessageAt = new Date("2026-08-22T12:00:00.001Z");

    expect(calculateServiceWindow(lastCustomerMessageAt, now)).toEqual({
      status: "OPEN",
      closesAt: new Date("2026-08-23T12:00:00.001Z"),
    });
  });

  it("is closed at exactly 24 hours", () => {
    const lastCustomerMessageAt = new Date("2026-08-22T12:00:00.000Z");

    expect(calculateServiceWindow(lastCustomerMessageAt, now)).toEqual({
      status: "CLOSED",
      closesAt: new Date("2026-08-23T12:00:00.000Z"),
    });
  });

  it("keeps free-form sending available while enforcement is inactive", async () => {
    const snapshot = await getMessagingPolicySnapshot(
      conversationId,
      now,
      repository({
        enforcement: "INACTIVE",
        lastCustomerMessageAt: null,
        pendingCustomerMessageId: null,
      }),
    );

    expect(snapshot).toMatchObject({
      enforcement: "INACTIVE",
      status: "CLOSED",
      sendMode: "FREE_FORM",
      reason: null,
    });
    await expect(
      assertFreeFormSendAllowed(conversationId, now, repository({
        enforcement: "INACTIVE",
        lastCustomerMessageAt: null,
      })),
    ).resolves.toBeUndefined();
  });

  it("rejects free-form sending with a stable code at the exact boundary", async () => {
    await expect(
      assertFreeFormSendAllowed(
        conversationId,
        now,
        repository({
          lastCustomerMessageAt: new Date("2026-08-22T12:00:00.000Z"),
        }),
      ),
    ).rejects.toMatchObject({
      status: 409,
      code: "WHATSAPP_SERVICE_WINDOW_CLOSED",
    });
  });

  it("lets an active opt-out override an otherwise open window", async () => {
    await expect(
      assertFreeFormSendAllowed(
        conversationId,
        now,
        repository({
          lastCustomerMessageAt: new Date("2026-08-23T11:59:00.000Z"),
          messagingOptOutAt: new Date("2026-08-23T11:59:30.000Z"),
        }),
      ),
    ).rejects.toMatchObject({
      status: 409,
      code: "WHATSAPP_CONTACT_OPTED_OUT",
    });
  });

  it("does not expose an internal pending-message id", async () => {
    const snapshot = await getMessagingPolicySnapshot(
      conversationId,
      now,
      repository({
        lastCustomerMessageAt: new Date("2026-08-22T11:59:59.000Z"),
      }),
    );

    expect(snapshot).not.toHaveProperty("pendingCustomerMessageId");
    expect(JSON.stringify(snapshot)).not.toContain(
      "50000000-0000-4000-8000-000000000002",
    );
  });
});
