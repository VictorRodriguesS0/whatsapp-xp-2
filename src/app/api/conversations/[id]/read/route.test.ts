// @vitest-environment node

import { describe, expect, it } from "vitest";

import { UserRole } from "@/generated/prisma/enums";
import { HttpError } from "@/lib/http";

import { createConversationReadRouteHandlers } from "./route";

const id = "10000000-0000-4000-8000-000000000001";
const messageId = "20000000-0000-4000-8000-000000000001";
const actor = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Victor",
  email: "victor@example.test",
  role: UserRole.ADMIN,
};
const state = {
  conversationId: id,
  unreadCount: 0,
  manuallyUnread: false,
  manualUnreadRevision: null,
  awaitingResponseSince: null,
  revision: "2026-08-21T12:00:00.000Z",
};

describe("conversation read route", () => {
  it("checks origin and active auth, advances shared state, then publishes a revision-only event", async () => {
    const calls: string[] = [];
    const events: unknown[] = [];
    const { POST } = createConversationReadRouteHandlers({
      assertSameOrigin: () => calls.push("origin"),
      requireUser: async () => {
        calls.push("auth");
        return actor;
      },
      markSharedRead: async (
        userId,
        conversationId,
        receivedMessageId,
        observedManualUnreadRevision,
      ) => {
        calls.push("service");
        expect([userId, conversationId, receivedMessageId, observedManualUnreadRevision]).toEqual([
          actor.id,
          id,
          messageId,
          "2026-08-21T11:00:00.000Z",
        ]);
        return state;
      },
      publishRealtime: (event) => {
        calls.push("publish");
        events.push(event);
      },
    });

    const response = await POST(
      new Request(`http://localhost/api/conversations/${id}/read`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({
          messageId,
          observedManualUnreadRevision: "2026-08-21T11:00:00.000Z",
        }),
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

  it("checks origin before auth or parsing the request body", async () => {
    const calls: string[] = [];
    const request = new Request(`http://localhost/api/conversations/${id}/read`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost" },
    });
    request.json = async () => {
      calls.push("body");
      return {};
    };
    const { POST } = createConversationReadRouteHandlers({
      assertSameOrigin: () => {
        calls.push("origin");
        throw new HttpError(403, "Origem inválida");
      },
      requireUser: async () => {
        calls.push("auth");
        return actor;
      },
      markSharedRead: async () => {
        throw new Error("must not be called");
      },
      publishRealtime: () => {
        throw new Error("must not be called");
      },
    });

    const response = await POST(request, { params: Promise.resolve({ id }) });

    expect(calls).toEqual(["origin"]);
    expect(response.status).toBe(403);
  });

  it("returns a safe stable validation error for an invalid UUID or stale-revision shape", async () => {
    const { POST } = createConversationReadRouteHandlers({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      markSharedRead: async () => {
        throw new Error("must not be called");
      },
      publishRealtime: () => {
        throw new Error("must not be called");
      },
    });

    const response = await POST(
      new Request("http://localhost/api/conversations/not-a-uuid/read", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({
          messageId,
          observedManualUnreadRevision: "not-an-iso-datetime",
        }),
      }),
      { params: Promise.resolve({ id: "not-a-uuid" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      data: null,
      error: { code: "INVALID_INPUT", message: "Dados inválidos" },
    });
  });

  it("rejects a non-ISO observed manual-unread revision", async () => {
    const { POST } = createConversationReadRouteHandlers({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      markSharedRead: async () => {
        throw new Error("must not be called");
      },
      publishRealtime: () => {
        throw new Error("must not be called");
      },
    });

    const response = await POST(
      new Request(`http://localhost/api/conversations/${id}/read`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({ messageId, observedManualUnreadRevision: "not-an-iso-datetime" }),
      }),
      { params: Promise.resolve({ id }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      data: null,
      error: { code: "INVALID_INPUT", message: "Dados inválidos" },
    });
  });

  it("returns a safe error and does not publish when the read service fails", async () => {
    const events: unknown[] = [];
    const { POST } = createConversationReadRouteHandlers({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      markSharedRead: async () => {
        throw new Error("database credentials must stay private");
      },
      publishRealtime: (event) => events.push(event),
    });

    const response = await POST(
      new Request(`http://localhost/api/conversations/${id}/read`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({ messageId, observedManualUnreadRevision: null }),
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
