// @vitest-environment node

import { describe, expect, it } from "vitest";

import { UserRole } from "@/generated/prisma/enums";
import { HttpError } from "@/lib/http";

import { createContactMessagingRestrictionRouteHandlers } from "./route";

const origin = "http://localhost:3000";
const contactId = "10000000-0000-4000-8000-000000000001";
const actor = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Ana",
  email: "ana@example.test",
  role: UserRole.ATTENDANT,
};

function request(body: unknown): Request {
  return new Request(
    `${origin}/api/contacts/${contactId}/messaging-restriction`,
    {
      method: "PUT",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify(body),
    },
  );
}

describe("contact messaging restriction route", () => {
  it("orders origin and authentication and publishes only the contact id after commit", async () => {
    const calls: string[] = [];
    const events: unknown[] = [];
    const { PUT } = createContactMessagingRestrictionRouteHandlers({
      assertSameOrigin: () => calls.push("origin"),
      requireUser: async () => {
        calls.push("auth");
        return actor;
      },
      setContactMessagingRestriction: async (receivedActor, receivedId, input) => {
        calls.push("service");
        expect(receivedActor).toBe(actor);
        expect(receivedId).toBe(contactId);
        expect(input).toEqual({
          restricted: true,
          reason: "Cliente pediu bloqueio",
        });
        return { messagingRestricted: true };
      },
      publishRealtime: (event) => {
        calls.push("publish");
        events.push(event);
      },
    });

    const response = await PUT(
      request({ restricted: true, reason: "  Cliente pediu bloqueio  " }),
      { params: Promise.resolve({ id: contactId }) },
    );

    expect(calls).toEqual(["origin", "auth", "service", "publish"]);
    expect(events).toEqual([{ type: "contact.updated", contactId }]);
    expect(JSON.stringify(events)).not.toContain("Cliente pediu bloqueio");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { messagingRestricted: true },
      error: null,
    });
  });

  it.each([
    ["short reason", { restricted: true, reason: "x" }, contactId],
    ["missing state", { reason: "Pedido válido" }, contactId],
    [
      "unknown field",
      { restricted: true, reason: "Pedido válido", actorUserId: actor.id },
      contactId,
    ],
    ["invalid contact", { restricted: true, reason: "Pedido válido" }, "bad"],
  ])("rejects %s before service and publication", async (_label, body, id) => {
    const calls: string[] = [];
    const { PUT } = createContactMessagingRestrictionRouteHandlers({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      setContactMessagingRestriction: async () => {
        calls.push("service");
        return { messagingRestricted: true };
      },
      publishRealtime: () => calls.push("publish"),
    });

    const response = await PUT(request(body), {
      params: Promise.resolve({ id }),
    });

    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it("stops invalid origin before authentication and never publishes failures", async () => {
    const calls: string[] = [];
    const { PUT } = createContactMessagingRestrictionRouteHandlers({
      assertSameOrigin: () => {
        calls.push("origin");
        throw new HttpError(403, "Origem inválida");
      },
      requireUser: async () => {
        calls.push("auth");
        return actor;
      },
      setContactMessagingRestriction: async () => {
        calls.push("service");
        return { messagingRestricted: true };
      },
      publishRealtime: () => calls.push("publish"),
    });

    const response = await PUT(
      request({ restricted: true, reason: "Pedido válido" }),
      { params: Promise.resolve({ id: contactId }) },
    );

    expect(response.status).toBe(403);
    expect(calls).toEqual(["origin"]);
  });

  it("preserves authentication and service failures without publishing", async () => {
    const events: unknown[] = [];
    const unauthorized = createContactMessagingRestrictionRouteHandlers({
      assertSameOrigin: () => undefined,
      requireUser: async () => {
        throw new HttpError(401, "Não autenticado");
      },
      setContactMessagingRestriction: async () => ({
        messagingRestricted: true,
      }),
      publishRealtime: (event) => events.push(event),
    });
    const failed = createContactMessagingRestrictionRouteHandlers({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      setContactMessagingRestriction: async () => {
        throw new HttpError(404, "Contato não encontrado");
      },
      publishRealtime: (event) => events.push(event),
    });

    const body = { restricted: true, reason: "Pedido válido" };
    const unauthorizedResponse = await unauthorized.PUT(request(body), {
      params: Promise.resolve({ id: contactId }),
    });
    const failedResponse = await failed.PUT(request(body), {
      params: Promise.resolve({ id: contactId }),
    });

    expect(unauthorizedResponse.status).toBe(401);
    expect(failedResponse.status).toBe(404);
    expect(events).toEqual([]);
  });
});
