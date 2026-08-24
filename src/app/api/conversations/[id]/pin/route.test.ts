// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { UserRole } from "@/generated/prisma/enums";
import { HttpError } from "@/lib/http";

import { createConversationPinRouteHandlers } from "./route";

const conversationId = "10000000-0000-4000-8000-000000000001";
const actor = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Victor",
  email: "victor@example.test",
  role: UserRole.ADMIN,
};

function request(body: unknown) {
  return new Request(`http://localhost/api/conversations/${conversationId}/pin`, {
    method: "PATCH",
    headers: { "content-type": "application/json", origin: "http://localhost" },
    body: JSON.stringify(body),
  });
}

describe("conversation pin route", () => {
  it("persists the shared pin and publishes a conversation revision", async () => {
    const state = {
      conversationId,
      pinnedAt: "2026-08-23T13:45:00.000Z",
      revision: "2026-08-23T13:45:00.000Z",
    };
    const setConversationPinned = vi.fn(async () => state);
    const events: unknown[] = [];
    const { PATCH } = createConversationPinRouteHandlers({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      setConversationPinned,
      publishRealtime: (event) => events.push(event),
    });

    const response = await PATCH(request({ pinned: true }), {
      params: Promise.resolve({ id: conversationId }),
    });

    expect(setConversationPinned).toHaveBeenCalledWith(actor.id, conversationId, true);
    expect(events).toEqual([{
      type: "conversation.updated",
      conversationId,
      revision: state.revision,
    }]);
    await expect(response.json()).resolves.toEqual({ data: state, error: null });
  });

  it("rejects invalid payloads before mutating or publishing", async () => {
    const setConversationPinned = vi.fn();
    const publishRealtime = vi.fn();
    const { PATCH } = createConversationPinRouteHandlers({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      setConversationPinned,
      publishRealtime,
    });

    const response = await PATCH(request({ pinned: "yes", extra: true }), {
      params: Promise.resolve({ id: conversationId }),
    });

    expect(response.status).toBe(400);
    expect(setConversationPinned).not.toHaveBeenCalled();
    expect(publishRealtime).not.toHaveBeenCalled();
  });

  it("preserves a safe not-found error and does not publish", async () => {
    const publishRealtime = vi.fn();
    const { PATCH } = createConversationPinRouteHandlers({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      setConversationPinned: async () => {
        throw new HttpError(404, "Conversa não encontrada");
      },
      publishRealtime,
    });

    const response = await PATCH(request({ pinned: false }), {
      params: Promise.resolve({ id: conversationId }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      data: null,
      error: { code: "NOT_FOUND", message: "Conversa não encontrada" },
    });
    expect(publishRealtime).not.toHaveBeenCalled();
  });
});
