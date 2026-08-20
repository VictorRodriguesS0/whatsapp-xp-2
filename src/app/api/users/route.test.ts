// @vitest-environment node

import { describe, expect, it } from "vitest";

import { UserRole } from "@/generated/prisma/enums";
import { HttpError } from "@/lib/http";

import { createUsersRouteHandlers } from "./route";

const origin = "http://localhost:3000";
const admin = {
  id: "06a86959-3b28-4ff5-84df-b2fc7665154d",
  name: "Victor",
  email: "victor@example.test",
  role: UserRole.ADMIN,
};

function jsonRequest(body: unknown): Request {
  return new Request(`${origin}/api/users`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

describe("users collection route", () => {
  it("publishes an invalidation only after creating a user", async () => {
    const events: unknown[] = [];
    const user = { ...admin, active: true, createdAt: new Date(0), updatedAt: new Date(0) };
    const { POST } = createUsersRouteHandlers({
      assertSameOrigin: () => undefined,
      requireAdmin: async () => admin,
      listUsers: async () => [],
      createUser: async () => user,
      publishRealtime: (event) => events.push(event),
    });

    const response = await POST(
      jsonRequest({
        name: "Ana",
        email: "ana@example.test",
        password: "Senha-Demo-2026!",
        role: UserRole.ATTENDANT,
      }),
    );

    expect(response.status).toBe(201);
    expect(events).toEqual([{ type: "user.updated", userId: user.id }]);
  });

  it("returns a safe 400 before calling the service for an invalid create request", async () => {
    let serviceWasCalled = false;
    const { POST } = createUsersRouteHandlers({
      assertSameOrigin: () => undefined,
      requireAdmin: async () => admin,
      listUsers: async () => [],
      createUser: async () => {
        serviceWasCalled = true;
        throw new Error("unreachable");
      },
      publishRealtime: () => {
        throw new Error("must not be called");
      },
    });

    const response = await POST(jsonRequest({ email: "not-an-email" }));

    expect(response.status).toBe(400);
    expect(serviceWasCalled).toBe(false);
    await expect(response.json()).resolves.toEqual({ error: "Dados inválidos" });
  });

  it("maps duplicate email conflicts to 409", async () => {
    const { POST } = createUsersRouteHandlers({
      assertSameOrigin: () => undefined,
      requireAdmin: async () => admin,
      listUsers: async () => [],
      createUser: async () => {
        throw new HttpError(409, "E-mail já cadastrado");
      },
      publishRealtime: () => {
        throw new Error("must not be called");
      },
    });

    const response = await POST(
      jsonRequest({
        name: "Ana",
        email: "ana@example.test",
        password: "Senha-Demo-2026!",
        role: UserRole.ATTENDANT,
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "E-mail já cadastrado",
    });
  });
});
