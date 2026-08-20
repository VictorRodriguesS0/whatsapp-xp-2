// @vitest-environment node

import { describe, expect, it } from "vitest";

import { UserRole } from "@/generated/prisma/enums";

import { createResetPasswordRouteHandlers } from "./route";

const origin = "http://localhost:3000";
const id = "06a86959-3b28-4ff5-84df-b2fc7665154d";
const admin = {
  id,
  name: "Victor",
  email: "victor@example.test",
  role: UserRole.ADMIN,
};

describe("reset password route", () => {
  it("returns a safe 400 before resetting an invalid password", async () => {
    let resetWasCalled = false;
    const { POST } = createResetPasswordRouteHandlers({
      assertSameOrigin: () => undefined,
      requireAdmin: async () => admin,
      resetUserPassword: async () => {
        resetWasCalled = true;
        return { ...admin, active: true, createdAt: new Date(0), updatedAt: new Date(0) };
      },
    });

    const response = await POST(
      new Request(`${origin}/api/users/${id}/reset-password`, {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify({ password: "short" }),
      }),
      { params: Promise.resolve({ id }) },
    );

    expect(response.status).toBe(400);
    expect(resetWasCalled).toBe(false);
    await expect(response.json()).resolves.toEqual({ error: "Dados inválidos" });
  });
});
