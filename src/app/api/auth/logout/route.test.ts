// @vitest-environment node

import { describe, expect, it } from "vitest";

import { createLogoutHandler } from "./route";

const origin = "http://localhost:3000";

describe("logout route", () => {
  it("revokes the current session and clears its cookie", async () => {
    let revoked = false;
    const handler = createLogoutHandler(async () => {
      revoked = true;
    });

    const response = await handler(
      new Request(`${origin}/api/auth/logout`, {
        method: "POST",
        headers: { origin },
      }),
    );

    expect(revoked).toBe(true);
    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toContain(
      "xp_atendimento_session=",
    );
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("returns a safe error instead of invoking logout for another origin", async () => {
    let revoked = false;
    const handler = createLogoutHandler(async () => {
      revoked = true;
    });

    const response = await handler(
      new Request(`${origin}/api/auth/logout`, {
        method: "POST",
        headers: { origin: "https://attacker.example" },
      }),
    );

    expect(revoked).toBe(false);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Origem inválida" });
  });
});
