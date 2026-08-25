// @vitest-environment node

import { describe, expect, it } from "vitest";

import { UserRole } from "@/generated/prisma/enums";
import { HttpError } from "@/lib/http";

import { createContactTagsRouteHandlers } from "./route";

const origin = "http://localhost:3000";
const contactId = "10000000-0000-4000-8000-000000000001";
const tagId = "20000000-0000-4000-8000-000000000001";
const actor = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Ana",
  email: "ana@example.test",
  role: UserRole.ATTENDANT,
};
const contact = {
  id: contactId,
  preferredName: null,
  name: "Carlos",
  phone: "+55 (11) 99999-1234",
  messagingRestricted: false,
  type: null,
  tags: [{ id: tagId, name: "VIP", color: "#A1B2C3", active: true }],
};

function request(body: unknown): Request {
  return new Request(`${origin}/api/contacts/${contactId}/tags`, {
    method: "PUT",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

describe("contact tags route", () => {
  it("orders origin, active auth, validation, atomic service and publication", async () => {
    const calls: string[] = [];
    const events: unknown[] = [];
    const bodyRequest = request([tagId.toUpperCase()]);
    const originalJson = bodyRequest.json.bind(bodyRequest);
    bodyRequest.json = async () => {
      calls.push("body");
      return originalJson();
    };
    const params = {
      then(resolve: (value: { id: string }) => unknown) {
        calls.push("params");
        return Promise.resolve(resolve({ id: contactId }));
      },
    } as Promise<{ id: string }>;
    const { PUT } = createContactTagsRouteHandlers({
      assertSameOrigin: () => calls.push("origin"),
      requireUser: async () => {
        calls.push("auth");
        return actor;
      },
      replaceContactTags: async (receivedActor, receivedId, tagIds) => {
        calls.push("service");
        expect(receivedActor).toBe(actor);
        expect(receivedId).toBe(contactId);
        expect(tagIds).toEqual([tagId]);
        return contact;
      },
      publishRealtime: (event) => {
        calls.push("publish");
        events.push(event);
      },
    });

    const response = await PUT(bodyRequest, { params });

    expect(calls).toEqual(["origin", "auth", "params", "body", "service", "publish"]);
    expect(events).toEqual([{ type: "contact.updated", contactId }]);
    await expect(response.json()).resolves.toEqual({ data: contact, error: null });
  });

  it("stops origin and inactive-session failures before body/service/publish", async () => {
    const calls: string[] = [];
    const originFailure = createContactTagsRouteHandlers({
      assertSameOrigin: () => {
        calls.push("origin");
        throw new HttpError(403, "Origem inválida");
      },
      requireUser: async () => {
        calls.push("auth");
        return actor;
      },
      replaceContactTags: async () => {
        calls.push("service");
        return contact;
      },
      publishRealtime: () => calls.push("publish"),
    });
    const inactive = createContactTagsRouteHandlers({
      assertSameOrigin: () => calls.push("origin-2"),
      requireUser: async () => {
        calls.push("auth-2");
        throw new HttpError(401, "Não autenticado");
      },
      replaceContactTags: async () => {
        calls.push("service-2");
        return contact;
      },
      publishRealtime: () => calls.push("publish-2"),
    });

    expect((await originFailure.PUT(request([]), { params: Promise.resolve({ id: contactId }) })).status).toBe(403);
    expect((await inactive.PUT(request([]), { params: Promise.resolve({ id: contactId }) })).status).toBe(401);
    expect(calls).toEqual(["origin", "origin-2", "auth-2"]);
  });

  it.each([
    ["bad contact UUID", [tagId], "bad-id"],
    ["bad tag UUID", ["bad-id"], contactId],
    ["semantic duplicate", [tagId, tagId.toUpperCase()], contactId],
    ["non-array body", { tagIds: [tagId] }, contactId],
  ])("rejects %s before service and publish", async (_label, body, id) => {
    const calls: string[] = [];
    const { PUT } = createContactTagsRouteHandlers({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      replaceContactTags: async () => {
        calls.push("service");
        return contact;
      },
      publishRealtime: () => calls.push("publish"),
    });

    const response = await PUT(request(body), { params: Promise.resolve({ id }) });

    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it("does not publish on missing, inactive or unexpected service failure", async () => {
    const events: unknown[] = [];
    let failure: unknown = new HttpError(404, "Etiqueta não encontrada");
    const { PUT } = createContactTagsRouteHandlers({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      replaceContactTags: async () => {
        throw failure;
      },
      publishRealtime: (event) => events.push(event),
    });

    const missing = await PUT(request([tagId]), { params: Promise.resolve({ id: contactId }) });
    failure = new HttpError(400, "Etiqueta indisponível");
    const inactive = await PUT(request([tagId]), { params: Promise.resolve({ id: contactId }) });
    failure = new Error("raw provider/storage details");
    const unexpected = await PUT(request([tagId]), { params: Promise.resolve({ id: contactId }) });

    expect(missing.status).toBe(404);
    expect(inactive.status).toBe(400);
    expect(unexpected.status).toBe(500);
    await expect(unexpected.json()).resolves.toEqual({
      data: null,
      error: { code: "INTERNAL_ERROR", message: "Erro interno" },
    });
    expect(events).toEqual([]);
  });
});
