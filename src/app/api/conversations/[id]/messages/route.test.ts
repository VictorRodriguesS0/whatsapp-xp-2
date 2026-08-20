// @vitest-environment node

import { describe, expect, it } from "vitest";

import { MessageDirection, MessageStatus, MessageType, UserRole } from "@/generated/prisma/enums";

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

  it("sends JSON text as the authenticated actor and ignores spoofable identity headers", async () => {
    let received: unknown;
    const { POST } = createConversationMessagesRouteHandlers({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      sendMessage: async (receivedActor, receivedConversationId, input) => {
        received = { actor: receivedActor, conversationId: receivedConversationId, input };
        return {
          id,
          direction: MessageDirection.OUTBOUND,
          type: MessageType.TEXT,
          body: "Oi",
          mediaObjectId: null,
          sentBy: { id: actor.id, name: actor.name },
          status: MessageStatus.SENT,
          failureReason: null,
          externalTimestamp: new Date(0).toISOString(),
          createdAt: new Date(0).toISOString(),
        };
      },
    });
    const clientRequestId = "40000000-0000-4000-8000-000000000001";

    const response = await POST(
      new Request(`http://localhost/api/conversations/${id}/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-id": "attacker-controlled",
          "x-forwarded-user": "attacker-controlled",
        },
        body: JSON.stringify({ type: "TEXT", clientRequestId, body: "Oi" }),
      }),
      { params: Promise.resolve({ id }) },
    );

    expect(response.status).toBe(201);
    expect(received).toEqual({
      actor,
      conversationId: id,
      input: { type: "TEXT", clientRequestId, body: "Oi" },
    });
  });

  it("accepts multipart document bytes without trusting the supplied filename as a path", async () => {
    let receivedInput: any;
    const { POST } = createConversationMessagesRouteHandlers({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      sendMessage: async (_actor, _conversationId, input) => {
        receivedInput = input;
        return {
          id,
          direction: MessageDirection.OUTBOUND,
          type: MessageType.DOCUMENT,
          body: null,
          mediaObjectId: id,
          sentBy: { id: actor.id, name: actor.name },
          status: MessageStatus.SENT,
          failureReason: null,
          externalTimestamp: new Date(0).toISOString(),
          createdAt: new Date(0).toISOString(),
        };
      },
    });
    const form = new FormData();
    form.set("type", "DOCUMENT");
    form.set("clientRequestId", "40000000-0000-4000-8000-000000000001");
    form.set("file", new File([new TextEncoder().encode("%PDF-1.7")], "../../nota.pdf", { type: "application/pdf" }));

    const response = await POST(
      new Request(`http://localhost/api/conversations/${id}/messages`, { method: "POST", body: form }),
      { params: Promise.resolve({ id }) },
    );

    expect(response.status).toBe(201);
    expect(receivedInput.file).toMatchObject({
      filename: "../../nota.pdf",
      mimeType: "application/pdf",
      bytes: new TextEncoder().encode("%PDF-1.7"),
    });
  });
});
