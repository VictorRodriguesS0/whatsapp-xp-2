// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { UserRole } from "@/generated/prisma/enums";

import { createConversationMessageSearchRouteHandlers } from "./route";

const actor = { id: "10000000-0000-4000-8000-000000000001", name: "Ana", email: "ana@example.test", role: UserRole.ATTENDANT };
const conversationId = "20000000-0000-4000-8000-000000000001";

describe("conversation message search route", () => {
  it("awaits params and scopes the validated search", async () => {
    const searchConversationMessages = vi.fn().mockResolvedValue({ items: [], nextCursor: null });
    const { GET } = createConversationMessageSearchRouteHandlers({ requireUser: async () => actor, searchConversationMessages });

    const response = await GET(
      new Request(`http://localhost/api/conversations/${conversationId}/message-search?query=produto`),
      { params: Promise.resolve({ id: conversationId }) },
    );

    expect(searchConversationMessages).toHaveBeenCalledWith(actor.id, conversationId, { query: "produto", take: 20 });
    expect(response.status).toBe(200);
  });

  it("rejects invalid conversation ids", async () => {
    const { GET } = createConversationMessageSearchRouteHandlers({ requireUser: async () => actor });
    const response = await GET(new Request("http://localhost/api/conversations/no/message-search?query=produto"), { params: Promise.resolve({ id: "no" }) });
    expect(response.status).toBe(400);
  });
});
