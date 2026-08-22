// @vitest-environment node

import { describe, expect, it } from "vitest";

import { UserRole } from "@/generated/prisma/enums";
import { HttpError } from "@/lib/http";

import { createContactTypesRouteHandlers } from "./route";

const origin = "http://localhost:3000";
const admin = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Victor",
  email: "victor@example.test",
  role: UserRole.ADMIN,
};
const attendant = { ...admin, role: UserRole.ATTENDANT };
const definition = {
  id: "10000000-0000-4000-8000-000000000001",
  displayName: "Cliente",
  color: "#A1B2C3",
  position: 10,
  active: true,
};

function postRequest(body: unknown): Request {
  return new Request(`${origin}/api/settings/contact-types`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

describe("contact type collection route", () => {
  it("lists active and inactive definitions in service order for an active admin", async () => {
    const inactive = { ...definition, id: "10000000-0000-4000-8000-000000000002", active: false };
    const { GET } = createContactTypesRouteHandlers({
      assertSameOrigin: () => undefined,
      requireAdmin: async () => admin,
      listContactTypes: async () => [definition, inactive],
      createContactType: async () => definition,
      publishRealtime: () => undefined,
    });

    const response = await GET();

    await expect(response.json()).resolves.toEqual({
      data: { items: [definition, inactive] },
      error: null,
    });
  });

  it.each([
    ["unauthenticated", new HttpError(401, "Não autenticado"), 401],
    ["attendant", new HttpError(403, "Acesso negado"), 403],
    ["inactive admin", new HttpError(401, "Não autenticado"), 401],
  ])("rejects %s list access through the admin guard", async (_label, guardError, status) => {
    const { GET } = createContactTypesRouteHandlers({
      assertSameOrigin: () => undefined,
      requireAdmin: async () => {
        throw guardError;
      },
      listContactTypes: async () => {
        throw new Error("must not list");
      },
      createContactType: async () => definition,
      publishRealtime: () => undefined,
    });

    expect((await GET()).status).toBe(status);
  });

  it("orders origin, admin auth, body, service and scope-only publication", async () => {
    const calls: string[] = [];
    const events: unknown[] = [];
    const bodyRequest = postRequest({ displayName: " Cliente ", color: "#A1B2C3", position: 10 });
    const originalJson = bodyRequest.json.bind(bodyRequest);
    bodyRequest.json = async () => {
      calls.push("body");
      return originalJson();
    };
    const { POST } = createContactTypesRouteHandlers({
      assertSameOrigin: () => calls.push("origin"),
      requireAdmin: async () => {
        calls.push("auth");
        return admin;
      },
      listContactTypes: async () => [],
      createContactType: async (receivedActor, input) => {
        calls.push("service");
        expect(receivedActor).toBe(admin);
        expect(input).toEqual({ displayName: "Cliente", color: "#A1B2C3", position: 10 });
        return definition;
      },
      publishRealtime: (event) => {
        calls.push("publish");
        events.push(event);
      },
    });

    const response = await POST(bodyRequest);

    expect(calls).toEqual(["origin", "auth", "body", "service", "publish"]);
    expect(events).toEqual([{ type: "settings.updated", scope: "contact-types" }]);
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ data: definition, error: null });
  });

  it("stops cross-origin and role failures before body/service/publication", async () => {
    const calls: string[] = [];
    const originRoute = createContactTypesRouteHandlers({
      assertSameOrigin: () => {
        calls.push("origin");
        throw new HttpError(403, "Origem inválida");
      },
      requireAdmin: async () => {
        calls.push("auth");
        return admin;
      },
      listContactTypes: async () => [],
      createContactType: async () => {
        calls.push("service");
        return definition;
      },
      publishRealtime: () => calls.push("publish"),
    });
    const roleRoute = createContactTypesRouteHandlers({
      assertSameOrigin: () => calls.push("origin-2"),
      requireAdmin: async () => {
        calls.push("auth-2");
        expect(attendant.role).toBe(UserRole.ATTENDANT);
        throw new HttpError(403, "Acesso negado");
      },
      listContactTypes: async () => [],
      createContactType: async () => {
        calls.push("service-2");
        return definition;
      },
      publishRealtime: () => calls.push("publish-2"),
    });

    expect((await originRoute.POST(postRequest({}))).status).toBe(403);
    expect((await roleRoute.POST(postRequest({}))).status).toBe(403);
    expect(calls).toEqual(["origin", "origin-2", "auth-2"]);
  });

  it.each([
    ["empty body", {}],
    ["invalid color", { displayName: "Cliente", color: "#a1b2c3", position: 10 }],
    ["invalid position", { displayName: "Cliente", color: "#A1B2C3", position: -1 }],
    ["invalid name", { displayName: " ", color: "#A1B2C3", position: 10 }],
    ["unknown key", { displayName: "Cliente", color: "#A1B2C3", position: 10, active: false }],
  ])("rejects %s before create and publication", async (_label, body) => {
    const calls: string[] = [];
    const { POST } = createContactTypesRouteHandlers({
      assertSameOrigin: () => undefined,
      requireAdmin: async () => admin,
      listContactTypes: async () => [],
      createContactType: async () => {
        calls.push("service");
        return definition;
      },
      publishRealtime: () => calls.push("publish"),
    });

    const response = await POST(postRequest(body));

    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it("maps normalized duplicates and unexpected failures without publication", async () => {
    const events: unknown[] = [];
    let failure: unknown = new HttpError(409, "Nome já cadastrado");
    const { POST } = createContactTypesRouteHandlers({
      assertSameOrigin: () => undefined,
      requireAdmin: async () => admin,
      listContactTypes: async () => [],
      createContactType: async () => {
        throw failure;
      },
      publishRealtime: (event) => events.push(event),
    });
    const body = { displayName: "Cliente", color: "#A1B2C3", position: 10 };

    const duplicate = await POST(postRequest(body));
    failure = new Error("raw prisma/provider data");
    const unexpected = await POST(postRequest(body));

    expect(duplicate.status).toBe(409);
    expect(unexpected.status).toBe(500);
    await expect(unexpected.json()).resolves.toEqual({
      data: null,
      error: { code: "INTERNAL_ERROR", message: "Erro interno" },
    });
    expect(events).toEqual([]);
  });
});
