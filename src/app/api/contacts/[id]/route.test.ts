// @vitest-environment node

import { describe, expect, it } from "vitest";

import { UserRole } from "@/generated/prisma/enums";
import { HttpError } from "@/lib/http";

import { createContactRouteHandlers } from "./route";

const origin = "http://localhost:3000";
const contactId = "10000000-0000-4000-8000-000000000001";
const actor = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Ana",
  email: "ana@example.test",
  role: UserRole.ATTENDANT,
};
const contact = {
  id: contactId,
  preferredName: "Bia",
  name: "Bia",
  phone: "+55 (11) 99999-1234",
  messagingRestricted: false,
  messagingConsent: {
    active: false,
    source: null,
    grantedAt: null,
    grantedBy: null,
    note: null,
  },
  type: null,
  tags: [],
};

function request(body: unknown): Request {
  return new Request(`${origin}/api/contacts/${contactId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

function trackedParams(calls: string[], id = contactId) {
  return {
    then(resolve: (value: { id: string }) => unknown) {
      calls.push("params");
      return Promise.resolve(resolve({ id }));
    },
  } as Promise<{ id: string }>;
}

describe("contact item route", () => {
  it("orders origin, active auth, params, body, service and ID-only publication", async () => {
    const calls: string[] = [];
    const events: unknown[] = [];
    const bodyRequest = request({ preferredName: " Bia " });
    const originalJson = bodyRequest.json.bind(bodyRequest);
    bodyRequest.json = async () => {
      calls.push("body");
      return originalJson();
    };
    const { PATCH } = createContactRouteHandlers({
      assertSameOrigin: () => calls.push("origin"),
      requireUser: async () => {
        calls.push("auth");
        return actor;
      },
      updateContact: async (receivedActor, receivedId, input) => {
        calls.push("service");
        expect(receivedActor).toBe(actor);
        expect(receivedId).toBe(contactId);
        expect(input).toEqual({ preferredName: "Bia" });
        return contact;
      },
      publishRealtime: (event) => {
        calls.push("publish");
        events.push(event);
      },
    });

    const response = await PATCH(bodyRequest, { params: trackedParams(calls) });

    expect(calls).toEqual(["origin", "auth", "params", "body", "service", "publish"]);
    expect(events).toEqual([{ type: "contact.updated", contactId }]);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: contact, error: null });
  });

  it("stops same-origin failure before auth, params, body, service and publish", async () => {
    const calls: string[] = [];
    const bodyRequest = request({ preferredName: "Bia" });
    bodyRequest.json = async () => {
      calls.push("body");
      return {};
    };
    const { PATCH } = createContactRouteHandlers({
      assertSameOrigin: () => {
        calls.push("origin");
        throw new HttpError(403, "Origem inválida");
      },
      requireUser: async () => {
        calls.push("auth");
        return actor;
      },
      updateContact: async () => {
        calls.push("service");
        return contact;
      },
      publishRealtime: () => calls.push("publish"),
    });

    const response = await PATCH(bodyRequest, { params: trackedParams(calls) });

    expect(calls).toEqual(["origin"]);
    expect(response.status).toBe(403);
  });

  it("returns existing auth failures before validation or service", async () => {
    const calls: string[] = [];
    const { PATCH } = createContactRouteHandlers({
      assertSameOrigin: () => calls.push("origin"),
      requireUser: async () => {
        calls.push("auth");
        throw new HttpError(401, "Não autenticado");
      },
      updateContact: async () => {
        calls.push("service");
        return contact;
      },
      publishRealtime: () => calls.push("publish"),
    });

    const response = await PATCH(request({ preferredName: "Bia" }), {
      params: trackedParams(calls),
    });

    expect(calls).toEqual(["origin", "auth"]);
    expect(response.status).toBe(401);
  });

  it.each([
    ["invalid UUID", { preferredName: "Bia" }, "not-a-uuid"],
    ["empty patch", {}, contactId],
    ["unknown key", { preferredName: "Bia", phone: "5511999999999" }, contactId],
    ["invalid name", { preferredName: "   " }, contactId],
  ])("rejects %s before service and publication", async (_label, body, id) => {
    const calls: string[] = [];
    const { PATCH } = createContactRouteHandlers({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      updateContact: async () => {
        calls.push("service");
        return contact;
      },
      publishRealtime: () => calls.push("publish"),
    });

    const response = await PATCH(request(body), { params: Promise.resolve({ id }) });

    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
    await expect(response.json()).resolves.toEqual({
      data: null,
      error: { code: "INVALID_INPUT", message: "Dados inválidos" },
    });
  });

  it("maps malformed JSON and service failures safely without publishing", async () => {
    const events: unknown[] = [];
    const dependencies = {
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      updateContact: async () => {
        throw new Error("postgresql://secret@internal/provider-payload");
      },
      publishRealtime: (event: unknown) => events.push(event),
    };
    const { PATCH } = createContactRouteHandlers(dependencies);
    const malformed = new Request(`${origin}/api/contacts/${contactId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", origin },
      body: "{",
    });

    const malformedResponse = await PATCH(malformed, {
      params: Promise.resolve({ id: contactId }),
    });
    const failureResponse = await PATCH(request({ preferredName: "Bia" }), {
      params: Promise.resolve({ id: contactId }),
    });

    expect(malformedResponse.status).toBe(400);
    expect(failureResponse.status).toBe(500);
    await expect(failureResponse.json()).resolves.toEqual({
      data: null,
      error: { code: "INTERNAL_ERROR", message: "Erro interno" },
    });
    expect(events).toEqual([]);
  });

  it.each([
    [new HttpError(404, "Tipo de contato não encontrado"), 404],
    [new HttpError(400, "Tipo de contato indisponível"), 400],
  ])("preserves safe type-reference errors without publishing", async (failure, status) => {
    const events: unknown[] = [];
    const { PATCH } = createContactRouteHandlers({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      updateContact: async () => {
        throw failure;
      },
      publishRealtime: (event) => events.push(event),
    });

    const response = await PATCH(request({ contactTypeId: contactId }), {
      params: Promise.resolve({ id: contactId }),
    });

    expect(response.status).toBe(status);
    expect(events).toEqual([]);
  });

  it("keeps concurrent results isolated and publishes once per successful request", async () => {
    const secondId = "10000000-0000-4000-8000-000000000002";
    const events: unknown[] = [];
    const { PATCH } = createContactRouteHandlers({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      updateContact: async (_actor, id, input) => {
        const parsed = input as { preferredName?: string | null };
        return {
          ...contact,
          id,
          preferredName: parsed.preferredName ?? null,
          name: parsed.preferredName ?? contact.name,
        };
      },
      publishRealtime: (event) => events.push(event),
    });

    const [first, second] = await Promise.all([
      PATCH(request({ preferredName: "Um" }), { params: Promise.resolve({ id: contactId }) }),
      PATCH(request({ preferredName: "Dois" }), { params: Promise.resolve({ id: secondId }) }),
    ]);

    await expect(first.json()).resolves.toMatchObject({ data: { id: contactId, name: "Um" } });
    await expect(second.json()).resolves.toMatchObject({ data: { id: secondId, name: "Dois" } });
    expect(events).toEqual([
      { type: "contact.updated", contactId },
      { type: "contact.updated", contactId: secondId },
    ]);
  });
});
