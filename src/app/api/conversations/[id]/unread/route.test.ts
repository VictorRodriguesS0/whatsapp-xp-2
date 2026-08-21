// @vitest-environment node

import { describe, expect, it } from "vitest";

import { UserRole } from "@/generated/prisma/enums";
import { HttpError } from "@/lib/http";

import { createConversationUnreadRouteHandlers } from "./route";

const id = "10000000-0000-4000-8000-000000000001";
const actor = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Victor",
  email: "victor@example.test",
  role: UserRole.ADMIN,
};
const state = {
  conversationId: id,
  unreadCount: 2,
  manuallyUnread: true,
  manualUnreadRevision: "2026-08-21T12:00:00.000Z",
  awaitingResponseSince: "2026-08-21T10:00:00.000Z",
  revision: "2026-08-21T12:00:00.000Z",
};

describe("conversation unread route", () => {
  it("checks origin and active auth, marks shared state unread, then publishes a revision-only event", async () => {
    const calls: string[] = [];
    const events: unknown[] = [];
    const { POST } = createConversationUnreadRouteHandlers({
      assertSameOrigin: () => calls.push("origin"),
      requireUser: async () => {
        calls.push("auth");
        return actor;
      },
      markSharedUnread: async (userId, conversationId) => {
        calls.push("service");
        expect([userId, conversationId]).toEqual([actor.id, id]);
        return state;
      },
      publishRealtime: (event) => {
        calls.push("publish");
        events.push(event);
      },
    });

    const response = await POST(
      new Request(`http://localhost/api/conversations/${id}/unread`, {
        method: "POST",
        headers: { origin: "http://localhost" },
      }),
      { params: Promise.resolve({ id }) },
    );

    expect(calls).toEqual(["origin", "auth", "service", "publish"]);
    expect(events).toEqual([
      {
        type: "conversation.updated",
        conversationId: id,
        revision: "2026-08-21T12:00:00.000Z",
      },
    ]);
    await expect(response.json()).resolves.toEqual({ data: state, error: null });
  });

  it("checks origin before active auth", async () => {
    const calls: string[] = [];
    const { POST } = createConversationUnreadRouteHandlers({
      assertSameOrigin: () => {
        calls.push("origin");
        throw new HttpError(403, "Origem inválida");
      },
      requireUser: async () => {
        calls.push("auth");
        return actor;
      },
      markSharedUnread: async () => {
        throw new Error("must not be called");
      },
      publishRealtime: () => {
        throw new Error("must not be called");
      },
    });

    const response = await POST(
      new Request(`http://localhost/api/conversations/${id}/unread`, {
        method: "POST",
        headers: { origin: "http://localhost" },
      }),
      { params: Promise.resolve({ id }) },
    );

    expect(calls).toEqual(["origin"]);
    expect(response.status).toBe(403);
  });

  it("returns a safe stable validation error for an invalid UUID", async () => {
    const { POST } = createConversationUnreadRouteHandlers({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      markSharedUnread: async () => {
        throw new Error("must not be called");
      },
      publishRealtime: () => {
        throw new Error("must not be called");
      },
    });

    const response = await POST(
      new Request("http://localhost/api/conversations/not-a-uuid/unread", {
        method: "POST",
        headers: { origin: "http://localhost" },
      }),
      { params: Promise.resolve({ id: "not-a-uuid" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      data: null,
      error: { code: "INVALID_INPUT", message: "Dados inválidos" },
    });
  });

  it("returns a safe error and does not publish when the unread service fails", async () => {
    const events: unknown[] = [];
    const { POST } = createConversationUnreadRouteHandlers({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      markSharedUnread: async () => {
        throw new Error("database credentials must stay private");
      },
      publishRealtime: (event) => events.push(event),
    });

    const response = await POST(
      new Request(`http://localhost/api/conversations/${id}/unread`, {
        method: "POST",
        headers: { origin: "http://localhost" },
      }),
      { params: Promise.resolve({ id }) },
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      data: null,
      error: { code: "INTERNAL_ERROR", message: "Erro interno" },
    });
    expect(events).toEqual([]);
  });
});
