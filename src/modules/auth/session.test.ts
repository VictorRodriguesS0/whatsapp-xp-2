// @vitest-environment node

import { createHmac } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { UserRole } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/modules/auth/password";
import { resetTestDatabase } from "@/test/database";

import {
  createSession,
  hashSessionToken,
  resolveSession,
  SESSION_DURATION_MS,
} from "./session";

describe("database sessions", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("stores only an HMAC of the opaque token", async () => {
    const user = await prisma.user.create({
      data: {
        name: "Victor",
        email: "victor.session@example.test",
        passwordHash: await hashPassword("Senha-Demo-2026!"),
        role: UserRole.ADMIN,
      },
    });

    const before = Date.now();
    const token = await createSession(user.id);
    const session = await prisma.session.findUniqueOrThrow({
      where: { tokenHash: hashSessionToken(token) },
    });

    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(token).not.toBe(session.tokenHash);
    expect(session.expiresAt.getTime()).toBeGreaterThanOrEqual(
      before + SESSION_DURATION_MS - 1_000,
    );
  });

  it("uses HMAC-SHA256 with the supplied secret", () => {
    const token = "opaque-session-token";
    const secret = "a-secret-with-at-least-thirty-two-characters";

    expect(hashSessionToken(token, secret)).toBe(
      createHmac("sha256", secret).update(token).digest("base64url"),
    );
  });

  it("rejects an inactive user even with a valid session", async () => {
    const sessionRepo = {
      findByTokenHash: async () => ({
        expiresAt: new Date(Date.now() + SESSION_DURATION_MS),
        user: {
          id: "f697fbf1-10c6-4a06-a22f-2b742fcb1019",
          name: "Inativo",
          email: "inativo@example.test",
          role: UserRole.ATTENDANT,
          active: false,
        },
      }),
    };

    await expect(resolveSession("cookie-token", sessionRepo)).resolves.toBeNull();
  });

  it("rejects an expired session", async () => {
    const sessionRepo = {
      findByTokenHash: async () => ({
        expiresAt: new Date(0),
        user: {
          id: "f697fbf1-10c6-4a06-a22f-2b742fcb1019",
          name: "Expirado",
          email: "expirado@example.test",
          role: UserRole.ADMIN,
          active: true,
        },
      }),
    };

    await expect(resolveSession("cookie-token", sessionRepo)).resolves.toBeNull();
  });
});
