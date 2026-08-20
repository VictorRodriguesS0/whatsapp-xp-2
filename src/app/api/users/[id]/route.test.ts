// @vitest-environment node

import { describe, expect, it } from "vitest";

import { UserRole } from "@/generated/prisma/enums";

import { createUserRouteHandlers } from "./route";

const origin = "http://localhost:3000";
const id = "06a86959-3b28-4ff5-84df-b2fc7665154d";
const admin = {
  id,
  name: "Victor",
  email: "victor@example.test",
  role: UserRole.ADMIN,
};

describe("individual user route", () => {
  it("awaits dynamic params before updating a user", async () => {
    let updatedId = "";
    const events: unknown[] = [];
    const { PATCH } = createUserRouteHandlers({
      assertSameOrigin: () => undefined,
      requireAdmin: async () => admin,
      updateUser: async (_actor, receivedId) => {
        updatedId = receivedId;
        return { ...admin, active: true, createdAt: new Date(0), updatedAt: new Date(0) };
      },
      publishRealtime: (event) => events.push(event),
    });

    const response = await PATCH(
      new Request(`${origin}/api/users/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify({ active: true }),
      }),
      { params: Promise.resolve({ id }) },
    );

    expect(response.status).toBe(200);
    expect(updatedId).toBe(id);
    expect(events).toEqual([{ type: "user.updated", userId: id }]);
  });
});
