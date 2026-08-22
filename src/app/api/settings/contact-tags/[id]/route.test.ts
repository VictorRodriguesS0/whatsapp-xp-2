// @vitest-environment node

import { describe, expect, it } from "vitest";

import { UserRole } from "@/generated/prisma/enums";
import { HttpError } from "@/lib/http";

import { createContactTagSettingsRouteHandlers } from "./route";

const origin = "http://localhost:3000";
const definitionId = "20000000-0000-4000-8000-000000000001";
const admin = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Victor",
  email: "victor@example.test",
  role: UserRole.ADMIN,
};
const definition = {
  id: definitionId,
  displayName: "VIP",
  color: "#A1B2C3",
  position: 20,
  active: true,
};

function request(body: unknown): Request {
  return new Request(`${origin}/api/settings/contact-tags/${definitionId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

describe("contact tag settings item route", () => {
  it("orders update transport and emits exactly one scope invalidation", async () => {
    const calls: string[] = [];
    const events: unknown[] = [];
    const bodyRequest = request({ color: "#A1B2C3", position: 20 });
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
    const { PATCH } = createContactTagSettingsRouteHandlers({
      assertSameOrigin: () => calls.push("origin"),
      requireAdmin: async () => {
        calls.push("auth");
        return admin;
      },
      updateContactTag: async (_actor, id, input) => {
        calls.push("service");
        expect([id, input]).toEqual([definitionId, { color: "#A1B2C3", position: 20 }]);
        return definition;
      },
      deactivateContactTag: async () => {
        throw new Error("must not deactivate");
      },
      publishRealtime: (event) => {
        calls.push("publish");
        events.push(event);
      },
    });

    const response = await PATCH(bodyRequest, { params });

    expect(calls).toEqual(["origin", "auth", "params", "body", "service", "publish"]);
    expect(events).toEqual([{ type: "settings.updated", scope: "contact-tags" }]);
    await expect(response.json()).resolves.toEqual({ data: definition, error: null });
  });

  it("deactivates without DELETE and preserves admin failures", async () => {
    const inactive = { ...definition, active: false };
    const handlers = createContactTagSettingsRouteHandlers({
      assertSameOrigin: () => undefined,
      requireAdmin: async () => admin,
      updateContactTag: async () => {
        throw new Error("must not update");
      },
      deactivateContactTag: async () => inactive,
      publishRealtime: () => undefined,
    });
    const authFailure = createContactTagSettingsRouteHandlers({
      assertSameOrigin: () => undefined,
      requireAdmin: async () => {
        throw new HttpError(403, "Acesso negado");
      },
      updateContactTag: async () => definition,
      deactivateContactTag: async () => inactive,
      publishRealtime: () => {
        throw new Error("must not publish");
      },
    });

    const response = await handlers.PATCH(request({ active: false }), {
      params: Promise.resolve({ id: definitionId }),
    });

    expect("DELETE" in handlers).toBe(false);
    expect(response.status).toBe(200);
    expect((await authFailure.PATCH(request({ position: 20 }), { params: Promise.resolve({ id: definitionId }) })).status).toBe(403);
  });

  it.each([
    ["invalid UUID", { position: 20 }, "bad-id"],
    ["empty patch", {}, definitionId],
    ["invalid color", { color: "red" }, definitionId],
    ["reactivation", { active: true }, definitionId],
    ["mixed deactivation", { active: false, position: 20 }, definitionId],
    ["unknown key", { position: 20, phone: "secret" }, definitionId],
  ])("rejects %s before services/publication", async (_label, body, id) => {
    const calls: string[] = [];
    const { PATCH } = createContactTagSettingsRouteHandlers({
      assertSameOrigin: () => undefined,
      requireAdmin: async () => admin,
      updateContactTag: async () => {
        calls.push("update");
        return definition;
      },
      deactivateContactTag: async () => {
        calls.push("deactivate");
        return definition;
      },
      publishRealtime: () => calls.push("publish"),
    });

    expect((await PATCH(request(body), { params: Promise.resolve({ id }) })).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it("does not publish on missing or unexpected service failures", async () => {
    const events: unknown[] = [];
    let failure: unknown = new HttpError(404, "Etiqueta não encontrada");
    const { PATCH } = createContactTagSettingsRouteHandlers({
      assertSameOrigin: () => undefined,
      requireAdmin: async () => admin,
      updateContactTag: async () => {
        throw failure;
      },
      deactivateContactTag: async () => definition,
      publishRealtime: (event) => events.push(event),
    });

    const missing = await PATCH(request({ position: 20 }), { params: Promise.resolve({ id: definitionId }) });
    failure = new Error("prisma payload");
    const unexpected = await PATCH(request({ position: 20 }), { params: Promise.resolve({ id: definitionId }) });

    expect(missing.status).toBe(404);
    expect(unexpected.status).toBe(500);
    await expect(unexpected.json()).resolves.toEqual({
      data: null,
      error: { code: "INTERNAL_ERROR", message: "Erro interno" },
    });
    expect(events).toEqual([]);
  });
});
