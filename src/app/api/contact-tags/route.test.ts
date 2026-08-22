// @vitest-environment node

import { describe, expect, it } from "vitest";

import { UserRole } from "@/generated/prisma/enums";
import { HttpError } from "@/lib/http";

import { createContactTagCatalogRouteHandlers } from "./route";

const actor = {
  id: "30000000-0000-4000-8000-000000000001",
  name: "Marcos",
  email: "marcos@example.test",
  role: UserRole.ATTENDANT,
};

const tag = {
  id: "20000000-0000-4000-8000-000000000001",
  displayName: "Aguardando produto",
  color: "#176B52",
  position: 10,
  active: true,
};

describe("active contact tag catalog route", () => {
  it("returns the active catalog to an authenticated attendant", async () => {
    const calls: string[] = [];
    const { GET } = createContactTagCatalogRouteHandlers({
      requireUser: async () => {
        calls.push("auth");
        return actor;
      },
      listActiveContactTags: async (receivedActor) => {
        calls.push("catalog");
        expect(receivedActor).toBe(actor);
        return [tag];
      },
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(calls).toEqual(["auth", "catalog"]);
    await expect(response.json()).resolves.toEqual({
      data: { items: [tag] },
      error: null,
    });
  });

  it("stops anonymous and inactive users without leaking catalog data", async () => {
    const calls: string[] = [];
    const anonymous = createContactTagCatalogRouteHandlers({
      requireUser: async () => {
        calls.push("anonymous-auth");
        throw new HttpError(401, "Não autenticado");
      },
      listActiveContactTags: async () => {
        calls.push("anonymous-catalog");
        return [tag];
      },
    });
    const inactive = createContactTagCatalogRouteHandlers({
      requireUser: async () => {
        calls.push("inactive-auth");
        return actor;
      },
      listActiveContactTags: async () => {
        calls.push("inactive-catalog");
        throw new HttpError(403, "Acesso negado");
      },
    });

    const anonymousResponse = await anonymous.GET();
    const inactiveResponse = await inactive.GET();

    expect(anonymousResponse.status).toBe(401);
    expect(inactiveResponse.status).toBe(403);
    expect(calls).toEqual(["anonymous-auth", "inactive-auth", "inactive-catalog"]);
    await expect(anonymousResponse.json()).resolves.toEqual({
      data: null,
      error: { code: "UNAUTHORIZED", message: "Não autenticado" },
    });
    await expect(inactiveResponse.json()).resolves.toEqual({
      data: null,
      error: { code: "FORBIDDEN", message: "Acesso negado" },
    });
  });

  it("maps unexpected failures to a safe response", async () => {
    const { GET } = createContactTagCatalogRouteHandlers({
      requireUser: async () => actor,
      listActiveContactTags: async () => {
        throw new Error("database host and credentials");
      },
    });

    const response = await GET();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      data: null,
      error: { code: "INTERNAL_ERROR", message: "Erro interno" },
    });
  });
});
