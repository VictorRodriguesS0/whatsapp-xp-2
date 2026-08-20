// @vitest-environment node

import { describe, expect, it } from "vitest";

import { UserRole } from "@/generated/prisma/enums";
import { HttpError } from "@/lib/http";

import { createConversationResponsibleRouteHandlers } from "./route";

const id = "10000000-0000-4000-8000-000000000001";
const actor = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Victor",
  email: "victor@example.test",
  role: UserRole.ADMIN,
};

describe("conversation responsible route", () => {
  it("accepts null to remove the responsible employee", async () => {
    let receivedUserId: string | null | undefined;
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
    const { PATCH } = createConversationResponsibleRouteHandlers({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      setResponsible: async (_actor, _id, userId) => {
        receivedUserId = userId;
        return detail;
      },
    });

    const response = await PATCH(
      new Request(`http://localhost/api/conversations/${id}/responsible`, {
        method: "PATCH",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({ userId: null }),
      }),
      { params: Promise.resolve({ id }) },
    );

    expect(receivedUserId).toBeNull();
    await expect(response.json()).resolves.toEqual({ data: detail, error: null });
  });

  it("preserves a safe domain error in the stable error envelope", async () => {
    const { PATCH } = createConversationResponsibleRouteHandlers({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      setResponsible: async () => {
        throw new HttpError(400, "Responsável deve ser um usuário ativo");
      },
    });

    const response = await PATCH(
      new Request(`http://localhost/api/conversations/${id}/responsible`, {
        method: "PATCH",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({ userId: "00000000-0000-4000-8000-000000000002" }),
      }),
      { params: Promise.resolve({ id }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      data: null,
      error: {
        code: "INVALID_INPUT",
        message: "Responsável deve ser um usuário ativo",
      },
    });
  });
});
