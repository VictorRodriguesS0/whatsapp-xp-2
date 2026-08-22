// @vitest-environment node

import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { UserRole } from "@/generated/prisma/enums";

import { createRetryReactionRouteHandlers } from "./route";

const reactionId = "30000000-0000-4000-8000-000000000001";
const actor = {
  id: "10000000-0000-4000-8000-000000000001",
  name: "Ana",
  email: "ana@example.test",
  role: UserRole.ATTENDANT,
};

describe("reaction retry route", () => {
  it("retries explicitly with a fresh client request id", async () => {
    const retryBusinessReaction = vi.fn(async () => ({
      id: reactionId,
      messageId: "20000000-0000-4000-8000-000000000001",
      reactor: "BUSINESS" as const,
      emoji: "👍",
      status: "SENT" as const,
      removed: false,
      sentBy: { id: actor.id, name: actor.name },
    }));
    const clientRequestId = randomUUID();
    const { POST } = createRetryReactionRouteHandlers({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      retryBusinessReaction,
    });
    const response = await POST(new Request(`http://localhost/api/reactions/${reactionId}/retry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientRequestId }),
    }), { params: Promise.resolve({ id: reactionId }) });

    expect(response.status).toBe(200);
    expect(retryBusinessReaction).toHaveBeenCalledWith(actor.id, reactionId, { clientRequestId });
  });

  it("returns 400 before the service for a malformed request", async () => {
    const retryBusinessReaction = vi.fn();
    const { POST } = createRetryReactionRouteHandlers({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      retryBusinessReaction,
    });
    const response = await POST(new Request(`http://localhost/api/reactions/${reactionId}/retry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientRequestId: "not-a-uuid" }),
    }), { params: Promise.resolve({ id: reactionId }) });
    expect(response.status).toBe(400);
    expect(retryBusinessReaction).not.toHaveBeenCalled();
  });
});
