// @vitest-environment node

import { describe, expect, it } from "vitest";

import { UserRole } from "@/generated/prisma/enums";
import { HttpError } from "@/lib/http";

import { createContactTypeRouteHandlers } from "./route";

const origin = "http://localhost:3000";
const definitionId = "10000000-0000-4000-8000-000000000001";
const admin = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Victor",
  email: "victor@example.test",
  role: UserRole.ADMIN,
};
const definition = {
  id: definitionId,
  displayName: "Cliente Ouro",
  color: "#A1B2C3",
  position: 20,
  active: true,
};

function request(body: unknown): Request {
  return new Request(`${origin}/api/settings/contact-types/${definitionId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

describe("contact type item route", () => {
  it("orders update transport and publishes exactly once after success", async () => {
    const calls: string[] = [];
    const events: unknown[] = [];
    const bodyRequest = request({ displayName: " Cliente Ouro ", position: 20 });
    const originalJson = bodyRequest.json.bind(bodyRequest);
    bodyRequest.json = async () => {
      calls.push("body");
      return originalJson();
    };
    const params = {
      then(resolve: (value: { id: string }) => unknown) {
        calls.push("params");
        return Promise.resolve(resolve({ id: definitionId }));
      },
    } as Promise<{ id: string }>;
    const { PATCH } = createContactTypeRouteHandlers({
      assertSameOrigin: () => calls.push("origin"),
      requireAdmin: async () => {
        calls.push("auth");
        return admin;
      },
      updateContactType: async (actor, id, input) => {
        calls.push("service");
        expect([actor, id, input]).toEqual([admin, definitionId, { displayName: "Cliente Ouro", position: 20 }]);
        return definition;
      },
      deactivateContactType: async () => {
        throw new Error("must not deactivate");
      },
      publishRealtime: (event) => {
        calls.push("publish");
        events.push(event);
      },
    });

    const response = await PATCH(bodyRequest, { params });

    expect(calls).toEqual(["origin", "auth", "params", "body", "service", "publish"]);
    expect(events).toEqual([{ type: "settings.updated", scope: "contact-types" }]);
    await expect(response.json()).resolves.toEqual({ data: definition, error: null });
  });

  it("deactivates through PATCH without exposing a DELETE handler", async () => {
    const inactive = { ...definition, active: false };
    const handlers = createContactTypeRouteHandlers({
      assertSameOrigin: () => undefined,
      requireAdmin: async () => admin,
      updateContactType: async () => {
        throw new Error("must not update");
      },
      deactivateContactType: async (actor, id) => {
        expect([actor, id]).toEqual([admin, definitionId]);
        return inactive;
      },
      publishRealtime: () => undefined,
    });

    const response = await handlers.PATCH(request({ active: false }), {
      params: Promise.resolve({ id: definitionId }),
    });

    expect("DELETE" in handlers).toBe(false);
    await expect(response.json()).resolves.toEqual({ data: inactive, error: null });
  });

  it("stops origin/auth failures before params/body/services/publication", async () => {
    const calls: string[] = [];
    const { PATCH } = createContactTypeRouteHandlers({
      assertSameOrigin: () => {
        calls.push("origin");
        throw new HttpError(403, "Origem inválida");
      },
      requireAdmin: async () => {
        calls.push("auth");
        return admin;
      },
      updateContactType: async () => {
        calls.push("update");
        return definition;
      },
      deactivateContactType: async () => {
        calls.push("deactivate");
        return definition;
      },
      publishRealtime: () => calls.push("publish"),
    });

    const response = await PATCH(request({ position: 20 }), {
      params: Promise.resolve({ id: definitionId }),
    });

    expect(response.status).toBe(403);
    expect(calls).toEqual(["origin"]);
  });

  it.each([
    ["invalid UUID", { position: 20 }, "bad-id"],
    ["empty patch", {}, definitionId],
    ["reactivation", { active: true }, definitionId],
    ["mixed deactivation", { active: false, position: 20 }, definitionId],
    ["unknown key", { position: 20, secret: "x" }, definitionId],
  ])("rejects %s before services and publication", async (_label, body, id) => {
    const calls: string[] = [];
    const { PATCH } = createContactTypeRouteHandlers({
      assertSameOrigin: () => undefined,
      requireAdmin: async () => admin,
      updateContactType: async () => {
        calls.push("update");
        return definition;
      },
      deactivateContactType: async () => {
        calls.push("deactivate");
        return definition;
      },
      publishRealtime: () => calls.push("publish"),
    });

    const response = await PATCH(request(body), { params: Promise.resolve({ id }) });

    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it("preserves safe not-found and sanitizes unexpected errors without publishing", async () => {
    const events: unknown[] = [];
    let failure: unknown = new HttpError(404, "Tipo de contato não encontrado");
    const { PATCH } = createContactTypeRouteHandlers({
      assertSameOrigin: () => undefined,
      requireAdmin: async () => admin,
      updateContactType: async () => {
        throw failure;
      },
      deactivateContactType: async () => definition,
      publishRealtime: (event) => events.push(event),
    });

    const missing = await PATCH(request({ position: 20 }), { params: Promise.resolve({ id: definitionId }) });
    failure = new Error("database credentials");
    const unexpected = await PATCH(request({ position: 20 }), { params: Promise.resolve({ id: definitionId }) });

    expect(missing.status).toBe(404);
    expect(unexpected.status).toBe(500);
    expect(events).toEqual([]);
  });
});
