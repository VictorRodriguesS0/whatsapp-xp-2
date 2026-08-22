// @vitest-environment node

import { describe, expect, it } from "vitest";

import { UserRole } from "@/generated/prisma/enums";
import { HttpError } from "@/lib/http";

import { createContactTagsSettingsRouteHandlers } from "./route";

const origin = "http://localhost:3000";
const admin = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Victor",
  email: "victor@example.test",
  role: UserRole.ADMIN,
};
const definition = {
  id: "20000000-0000-4000-8000-000000000001",
  displayName: "VIP",
  color: "#A1B2C3",
  position: 10,
  active: true,
};

function postRequest(body: unknown): Request {
  return new Request(`${origin}/api/settings/contact-tags`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

describe("contact tag settings collection route", () => {
  it("lists definitions, including inactive ones, for admins", async () => {
    const inactive = { ...definition, active: false };
    const { GET } = createContactTagsSettingsRouteHandlers({
      assertSameOrigin: () => undefined,
      requireAdmin: async () => admin,
      listContactTags: async () => [definition, inactive],
      createContactTag: async () => definition,
      publishRealtime: () => undefined,
    });

    await expect((await GET()).json()).resolves.toEqual({
      data: { items: [definition, inactive] },
      error: null,
    });
  });

  it("orders every create stage and emits one scope-only invalidation", async () => {
    const calls: string[] = [];
    const events: unknown[] = [];
    const bodyRequest = postRequest({ displayName: " VIP ", color: "#A1B2C3", position: 10 });
    const originalJson = bodyRequest.json.bind(bodyRequest);
    bodyRequest.json = async () => {
      calls.push("body");
      return originalJson();
    };
    const { POST } = createContactTagsSettingsRouteHandlers({
      assertSameOrigin: () => calls.push("origin"),
      requireAdmin: async () => {
        calls.push("auth");
        return admin;
      },
      listContactTags: async () => [],
      createContactTag: async (_actor, input) => {
        calls.push("service");
        expect(input).toEqual({ displayName: "VIP", color: "#A1B2C3", position: 10 });
        return definition;
      },
      publishRealtime: (event) => {
        calls.push("publish");
        events.push(event);
      },
    });

    const response = await POST(bodyRequest);

    expect(calls).toEqual(["origin", "auth", "body", "service", "publish"]);
    expect(events).toEqual([{ type: "settings.updated", scope: "contact-tags" }]);
    expect(response.status).toBe(201);
  });

  it("stops origin/admin failures before body/service/publication", async () => {
    const calls: string[] = [];
    const originRoute = createContactTagsSettingsRouteHandlers({
      assertSameOrigin: () => {
        calls.push("origin");
        throw new HttpError(403, "Origem inválida");
      },
      requireAdmin: async () => {
        calls.push("auth");
        return admin;
      },
      listContactTags: async () => [],
      createContactTag: async () => {
        calls.push("service");
        return definition;
      },
      publishRealtime: () => calls.push("publish"),
    });
    const authRoute = createContactTagsSettingsRouteHandlers({
      assertSameOrigin: () => calls.push("origin-2"),
      requireAdmin: async () => {
        calls.push("auth-2");
        throw new HttpError(401, "Não autenticado");
      },
      listContactTags: async () => [],
      createContactTag: async () => {
        calls.push("service-2");
        return definition;
      },
      publishRealtime: () => calls.push("publish-2"),
    });

    expect((await originRoute.POST(postRequest({}))).status).toBe(403);
    expect((await authRoute.POST(postRequest({}))).status).toBe(401);
    expect(calls).toEqual(["origin", "origin-2", "auth-2"]);
  });

  it("rejects malformed/unknown input and does not publish on any service failure", async () => {
    const calls: string[] = [];
    let failure: unknown = new HttpError(409, "Nome já cadastrado");
    const { POST } = createContactTagsSettingsRouteHandlers({
      assertSameOrigin: () => undefined,
      requireAdmin: async () => admin,
      listContactTags: async () => [],
      createContactTag: async () => {
        calls.push("service");
        throw failure;
      },
      publishRealtime: () => calls.push("publish"),
    });

    const invalid = await POST(postRequest({ displayName: "VIP", color: "#A1B2C3", position: 10, secret: true }));
    const duplicate = await POST(postRequest({ displayName: "VIP", color: "#A1B2C3", position: 10 }));
    failure = new Error("private storage details");
    const unexpected = await POST(postRequest({ displayName: "VIP", color: "#A1B2C3", position: 10 }));

    expect(invalid.status).toBe(400);
    expect(duplicate.status).toBe(409);
    expect(unexpected.status).toBe(500);
    expect(calls).toEqual(["service", "service"]);
  });
});
