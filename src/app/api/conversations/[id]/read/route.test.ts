// @vitest-environment node

import { describe, expect, it } from "vitest";

import { UserRole } from "@/generated/prisma/enums";

import { createConversationReadRouteHandlers } from "./route";

const id = "10000000-0000-4000-8000-000000000001";
const messageId = "20000000-0000-4000-8000-000000000001";
const actor = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Victor",
  email: "victor@example.test",
  role: UserRole.ADMIN,
};

describe("conversation read route", () => {
  it("checks origin, awaits params and marks only the actor read", async () => {
    const calls: string[] = [];
    const read = {
      conversationId: id,
      lastReadMessageId: messageId,
      lastReadAt: new Date(1).toISOString(),
    };
    const { POST } = createConversationReadRouteHandlers({
      assertSameOrigin: () => calls.push("origin"),
      requireUser: async () => actor,
      markRead: async (userId, conversationId, receivedMessageId) => {
        calls.push(`${userId}:${conversationId}:${receivedMessageId}`);
        return read;
      },
    });

    const response = await POST(
      new Request(`http://localhost/api/conversations/${id}/read`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({ messageId }),
      }),
      { params: Promise.resolve({ id }) },
    );

    expect(calls).toEqual(["origin", `${actor.id}:${id}:${messageId}`]);
    await expect(response.json()).resolves.toEqual({ data: read, error: null });
  });

  it("returns a safe stable validation error", async () => {
    const { POST } = createConversationReadRouteHandlers({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      markRead: async () => {
        throw new Error("must not be called");
      },
    });

    const response = await POST(
      new Request(`http://localhost/api/conversations/${id}/read`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({ messageId: "invalid" }),
      }),
      { params: Promise.resolve({ id }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      data: null,
      error: { code: "INVALID_INPUT", message: "Dados inválidos" },
    });
  });
});
