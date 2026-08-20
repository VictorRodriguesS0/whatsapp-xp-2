// @vitest-environment node

import { describe, expect, it } from "vitest";

import { UserRole } from "@/generated/prisma/enums";

import { createConversationMessagesRouteHandlers } from "./route";

const id = "10000000-0000-4000-8000-000000000001";
const actor = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Victor",
  email: "victor@example.test",
  role: UserRole.ADMIN,
};

describe("conversation history route", () => {
  it("awaits params and returns the stable success envelope", async () => {
    let receivedId = "";
    const detail = {
      id,
      contact: { id, name: "Carlos", phone: "1", profilePictureUrl: null },
      responsible: null,
      lastMessageAt: new Date(0).toISOString(),
      latestMessage: null,
      unreadCount: 0,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      messages: [],
      lastReadMessageId: null,
      lastReadAt: null,
    };
    const { GET } = createConversationMessagesRouteHandlers({
      requireUser: async () => actor,
      getConversation: async (_userId, conversationId) => {
        receivedId = conversationId;
        return detail;
      },
    });

    const response = await GET(new Request(`http://localhost/api/conversations/${id}/messages`), {
      params: Promise.resolve({ id }),
    });

    expect(receivedId).toBe(id);
    await expect(response.json()).resolves.toEqual({ data: detail, error: null });
  });
});
