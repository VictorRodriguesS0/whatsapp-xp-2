// @vitest-environment node

import { describe, expect, it } from "vitest";

import { UserRole } from "@/generated/prisma/enums";

import { assertSameOrigin, requireAdmin, requireUser } from "./guards";

const attendant = {
  id: "f697fbf1-10c6-4a06-a22f-2b742fcb1019",
  name: "Marcos",
  email: "marcos@example.test",
  role: UserRole.ATTENDANT,
};

describe("server authorization guards", () => {
  it("rejects an unauthenticated request", async () => {
    await expect(requireUser(async () => null)).rejects.toMatchObject({
      status: 401,
    });
  });

  it("rejects an attendant from an administrator-only operation", async () => {
    await expect(requireAdmin(async () => attendant)).rejects.toMatchObject({
      status: 403,
    });
  });

  it("allows an administrator", async () => {
    await expect(
      requireAdmin(async () => ({ ...attendant, role: UserRole.ADMIN })),
    ).resolves.toMatchObject({ role: UserRole.ADMIN });
  });

  it("accepts a request from the configured application origin", () => {
    expect(() =>
      assertSameOrigin(
        new Request("http://localhost:3000/api/auth/login", {
          headers: { origin: "http://localhost:3000" },
        }),
      ),
    ).not.toThrow();
  });

  it("rejects a request from another origin", () => {
    expect(() =>
      assertSameOrigin(
        new Request("http://localhost:3000/api/auth/login", {
          headers: { origin: "https://attacker.example" },
        }),
      ),
    ).toThrow(expect.objectContaining({ status: 403 }));
  });
});
