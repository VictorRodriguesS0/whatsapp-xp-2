// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { UserRole } from "@/generated/prisma/enums";

import { createMessageContextRouteHandlers } from "./route";

const actor = { id: "10000000-0000-4000-8000-000000000001", name: "Ana", email: "ana@example.test", role: UserRole.ATTENDANT };
const conversationId = "20000000-0000-4000-8000-000000000001";
const messageId = "30000000-0000-4000-8000-000000000001";

describe("message context route", () => {
  it("loads exact context as the authenticated actor", async () => {
    const context = { conversationId, targetMessageId: messageId, messages: [] };
    const loadMessageContext = vi.fn().mockResolvedValue(context);
    const { GET } = createMessageContextRouteHandlers({ requireUser: async () => actor, loadMessageContext });

    const response = await GET(
      new Request(`http://localhost/api/conversations/${conversationId}/messages/${messageId}/context`),
      { params: Promise.resolve({ id: conversationId, messageId }) },
    );

    expect(loadMessageContext).toHaveBeenCalledWith(actor.id, conversationId, messageId);
    await expect(response.json()).resolves.toEqual({ data: context, error: null });
  });

  it("rejects invalid message ids before calling the service", async () => {
    const loadMessageContext = vi.fn();
    const { GET } = createMessageContextRouteHandlers({ requireUser: async () => actor, loadMessageContext });
    const response = await GET(new Request("http://localhost/context"), { params: Promise.resolve({ id: conversationId, messageId: "bad" }) });
    expect(response.status).toBe(400);
    expect(loadMessageContext).not.toHaveBeenCalled();
  });
});
