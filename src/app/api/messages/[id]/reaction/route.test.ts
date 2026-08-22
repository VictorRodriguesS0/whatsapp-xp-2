// @vitest-environment node

import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { UserRole } from "@/generated/prisma/enums";
import { HttpError } from "@/lib/http";

import { createMessageReactionRouteHandlers } from "./route";

const messageId = "20000000-0000-4000-8000-000000000001";
const actor = {
  id: "10000000-0000-4000-8000-000000000001",
  name: "Ana",
  email: "ana@example.test",
  role: UserRole.ATTENDANT,
};

function request(body: BodyInit = JSON.stringify({ emoji: "👍", clientRequestId: randomUUID() })) {
  return new Request(`http://localhost/api/messages/${messageId}/reaction`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body,
  });
}

describe("message reaction route", () => {
  it("forwards the authenticated user and strict reaction input", async () => {
    const setBusinessReaction = vi.fn(async () => ({
      id: "30000000-0000-4000-8000-000000000001",
      messageId,
      reactor: "BUSINESS" as const,
      emoji: "👍",
      status: "SENT" as const,
      removed: false,
      sentBy: { id: actor.id, name: actor.name },
    }));
    const clientRequestId = randomUUID();
    const { PUT } = createMessageReactionRouteHandlers({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      setBusinessReaction,
    });

    const response = await PUT(
      request(JSON.stringify({ emoji: "👍", clientRequestId })),
      { params: Promise.resolve({ id: messageId }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { emoji: "👍" }, error: null });
    expect(setBusinessReaction).toHaveBeenCalledWith(actor.id, messageId, { emoji: "👍", clientRequestId });
  });

  it.each([
    ["invalid JSON", "{", 400],
    ["multiple emojis", JSON.stringify({ emoji: "👍👍", clientRequestId: randomUUID() }), 400],
    ["unknown field", JSON.stringify({ emoji: "👍", clientRequestId: randomUUID(), admin: true }), 400],
  ])("rejects %s", async (_label, body, status) => {
    const setBusinessReaction = vi.fn();
    const { PUT } = createMessageReactionRouteHandlers({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      setBusinessReaction,
    });
    const response = await PUT(request(body), { params: Promise.resolve({ id: messageId }) });
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ data: null, error: { code: "INVALID_INPUT" } });
    expect(setBusinessReaction).not.toHaveBeenCalled();
  });

  it.each([
    [401, "Não autenticado"],
    [404, "Mensagem não encontrada"],
    [409, "Mensagem não elegível"],
    [429, "Muitas solicitações"],
  ])("preserves safe HTTP %s failures", async (status, message) => {
    const { PUT } = createMessageReactionRouteHandlers({
      assertSameOrigin: () => undefined,
      requireUser: async () => {
        if (status === 401) throw new HttpError(status, message);
        return actor;
      },
      setBusinessReaction: async () => { throw new HttpError(status, message); },
    });
    const response = await PUT(request(), { params: Promise.resolve({ id: messageId }) });
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ data: null, error: { message } });
  });
});
