// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { UserRole } from "@/generated/prisma/enums";

import { createAssignableUsersRouteHandlers } from "./route";

describe("assignable users route", () => {
  it("allows an authenticated attendant to list the active assignment choices", async () => {
    const attendant = {
      id: "30000000-0000-4000-8000-000000000001",
      name: "Marcos",
      email: "marcos@xp.test",
      role: UserRole.ATTENDANT,
    };
    const choices = [
      { id: attendant.id, name: attendant.name },
      { id: "30000000-0000-4000-8000-000000000002", name: "Rita" },
    ];
    const listAssignableUsers = vi.fn().mockResolvedValue(choices);
    const { GET } = createAssignableUsersRouteHandlers({
      requireUser: async () => attendant,
      listAssignableUsers,
    });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { items: choices }, error: null });
    expect(listAssignableUsers).toHaveBeenCalledWith(attendant);
  });
});
