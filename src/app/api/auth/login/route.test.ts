// @vitest-environment node

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { UserRole } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/modules/auth/password";
import { resetTestDatabase } from "@/test/database";

import { POST } from "./route";

const origin = "http://localhost:3000";

function loginRequest(
  body: string,
  headers: Record<string, string> = {},
): Request {
  return new Request(`${origin}/api/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      ...headers,
    },
    body,
  });
}

describe("login route", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("uses X-Real-IP rather than spoofable X-Forwarded-For for rate limiting", async () => {
    const realIp = "198.51.100.40";

    for (let count = 0; count < 5; count += 1) {
      const response = await POST(
        loginRequest(
          JSON.stringify({
            email: `real-ip-${count}@example.test`,
            password: "Senha-Demo-2026!",
          }),
          {
            "x-real-ip": realIp,
            "x-forwarded-for": `203.0.113.${count}`,
          },
        ),
      );

      expect(response.status).toBe(401);
    }

    const response = await POST(
      loginRequest(
        JSON.stringify({
          email: "real-ip-final@example.test",
          password: "Senha-Demo-2026!",
        }),
        {
          "x-real-ip": realIp,
          "x-forwarded-for": "203.0.113.250",
        },
      ),
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: "Muitas tentativas. Tente novamente mais tarde",
    });
  });

  it("uses one stable direct bucket when Nginx did not provide X-Real-IP", async () => {
    for (let count = 0; count < 5; count += 1) {
      const response = await POST(
        loginRequest(
          JSON.stringify({
            email: `direct-${count}@example.test`,
            password: "Senha-Demo-2026!",
          }),
          { "x-forwarded-for": `203.0.113.${count}` },
        ),
      );

      expect(response.status).toBe(401);
    }

    expect(
      (
        await POST(
          loginRequest(
            JSON.stringify({
              email: "direct-final@example.test",
              password: "Senha-Demo-2026!",
            }),
            { "x-forwarded-for": "203.0.113.250" },
          ),
        )
      ).status,
    ).toBe(429);
  });

  it("resets failed attempts after a successful login and sets only a session cookie", async () => {
    const email = "victor.login@example.test";
    const ip = "198.51.100.41";
    await prisma.user.create({
      data: {
        name: "Victor",
        email,
        passwordHash: await hashPassword("Senha-Demo-2026!"),
        role: UserRole.ADMIN,
      },
    });

    for (let count = 0; count < 2; count += 1) {
      expect(
        (
          await POST(
            loginRequest(
              JSON.stringify({ email, password: "senha-incorreta" }),
              { "x-real-ip": ip },
            ),
          )
        ).status,
      ).toBe(401);
    }

    const success = await POST(
      loginRequest(
        JSON.stringify({ email, password: "Senha-Demo-2026!" }),
        { "x-real-ip": ip },
      ),
    );

    expect(success.status).toBe(200);
    await expect(success.json()).resolves.toMatchObject({
      user: { email, role: UserRole.ADMIN },
    });
    expect(success.headers.get("set-cookie")).toContain(
      "xp_atendimento_session=",
    );
    expect(success.headers.get("set-cookie")).toContain("HttpOnly");

    for (let count = 0; count < 5; count += 1) {
      expect(
        (
          await POST(
            loginRequest(
              JSON.stringify({ email, password: "senha-incorreta" }),
              { "x-real-ip": ip },
            ),
          )
        ).status,
      ).toBe(401);
    }

    expect(
      (
        await POST(
          loginRequest(
            JSON.stringify({ email, password: "senha-incorreta" }),
            { "x-real-ip": ip },
          ),
        )
      ).status,
    ).toBe(429);
  });

  it("returns a safe 400 response for malformed JSON", async () => {
    const response = await POST(loginRequest("{"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Dados inválidos" });
  });

  it("returns a safe error when the request origin is invalid", async () => {
    const response = await POST(
      new Request(`${origin}/api/auth/login`, {
        method: "POST",
        headers: { origin: "https://attacker.example" },
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Origem inválida" });
  });
});
