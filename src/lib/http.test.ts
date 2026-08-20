// @vitest-environment node

import { describe, expect, it } from "vitest";

import { HttpError, sessionCookieResponse, toErrorResponse } from "./http";

describe("HTTP helpers", () => {
  it("sets a secure seven-day session cookie without returning the token in JSON", async () => {
    const response = sessionCookieResponse(
      { user: { id: "user-id", name: "Victor", role: "ADMIN" } },
      "opaque-token",
    );

    expect(await response.json()).toEqual({
      user: { id: "user-id", name: "Victor", role: "ADMIN" },
    });
    expect(response.headers.get("set-cookie")).toContain("xp_atendimento_session=opaque-token");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=lax");
    expect(response.headers.get("set-cookie")).toContain("Path=/");
    expect(response.headers.get("set-cookie")).toContain("Secure");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=604800");
  });

  it("returns a sanitized public error", async () => {
    const response = toErrorResponse(
      new Error("postgresql://username:password@internal-host/private"),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Erro interno" });
  });

  it("preserves intentional HTTP error status without internals", async () => {
    const response = toErrorResponse(new HttpError(403, "Acesso negado"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Acesso negado" });
  });
});
