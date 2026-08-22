// @vitest-environment node

import { describe, expect, it } from "vitest";

import { UserRole } from "@/generated/prisma/enums";
import { HttpError } from "@/lib/http";

import { createContactTypeCatalogRouteHandlers } from "./route";

const actor = {
  id: "30000000-0000-4000-8000-000000000001",
  name: "Marcos",
  email: "marcos@example.test",
  role: UserRole.ATTENDANT,
};
const type = {
  id: "10000000-0000-4000-8000-000000000001",
  displayName: "Cliente",
  color: "#176B52",
  position: 10,
  active: true,
};

describe("active contact type catalog route", () => {
  it("returns the active catalog to an authenticated attendant", async () => {
    const calls: string[] = [];
    const { GET } = createContactTypeCatalogRouteHandlers({
      requireUser: async () => {
        calls.push("auth");
        return actor;
      },
      listActiveContactTypes: async (receivedActor) => {
        calls.push("catalog");
        expect(receivedActor).toBe(actor);
        return [type];
      },
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(calls).toEqual(["auth", "catalog"]);
    await expect(response.json()).resolves.toEqual({
      data: { items: [type] },
      error: null,
    });
  });

  it.each([
    [new HttpError(401, "Não autenticado"), 401, "UNAUTHORIZED"],
    [new HttpError(403, "Acesso negado"), 403, "FORBIDDEN"],
  ])("preserves safe authorization failures", async (failure, status, code) => {
    const { GET } = createContactTypeCatalogRouteHandlers({
      requireUser: async () => {
        throw failure;
      },
      listActiveContactTypes: async () => [type],
    });

    const response = await GET();
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({
      data: null,
      error: { code },
    });
  });

  it("maps unexpected failures without leaking internals", async () => {
    const { GET } = createContactTypeCatalogRouteHandlers({
      requireUser: async () => actor,
      listActiveContactTypes: async () => {
        throw new Error("postgresql://secret@internal");
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
