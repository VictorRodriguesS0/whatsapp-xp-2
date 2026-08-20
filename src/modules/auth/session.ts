import "server-only";

import { createHmac, randomBytes } from "node:crypto";

import { cookies } from "next/headers";
import { z } from "zod";

import { UserRole } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { getServerEnv } from "@/lib/env";
import {
  HttpError,
  SESSION_COOKIE_NAME,
  SESSION_DURATION_SECONDS,
} from "@/lib/http";

import { verifyPassword } from "./password";

export { SESSION_COOKIE_NAME, SESSION_DURATION_SECONDS } from "@/lib/http";
export const SESSION_DURATION_MS = SESSION_DURATION_SECONDS * 1_000;

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
};

type SessionLookup = {
  expiresAt: Date;
  user: SessionUser & { active: boolean };
};

export type SessionRepository = {
  findByTokenHash(tokenHash: string): Promise<SessionLookup | null>;
};

const sessionUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
} as const;

const sessionRepository: SessionRepository = {
  findByTokenHash(tokenHash) {
    return prisma.session.findUnique({
      where: { tokenHash },
      select: {
        expiresAt: true,
        user: { select: { ...sessionUserSelect, active: true } },
      },
    });
  },
};

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(1_024),
});

export type LoginInput = z.infer<typeof loginSchema>;

export function hashSessionToken(
  token: string,
  secret = getServerEnv().AUTH_SECRET,
): string {
  return createHmac("sha256", secret).update(token).digest("base64url");
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt,
    },
  });

  return token;
}

export async function resolveSession(
  token: string,
  repository: SessionRepository = sessionRepository,
  now = new Date(),
): Promise<SessionUser | null> {
  if (!token) {
    return null;
  }

  const session = await repository.findByTokenHash(hashSessionToken(token));

  if (!session || !session.user.active || session.expiresAt <= now) {
    return null;
  }

  const { active: _active, ...user } = session.user;
  return user;
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  return token ? resolveSession(token) : null;
}

export async function revokeCurrentSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (token) {
    await prisma.session.deleteMany({
      where: { tokenHash: hashSessionToken(token) },
    });
  }

  cookieStore.delete(SESSION_COOKIE_NAME);
}

export async function authenticate(input: LoginInput): Promise<SessionUser> {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: { ...sessionUserSelect, active: true, passwordHash: true },
  });

  if (!user || !user.active || !(await verifyPassword(input.password, user.passwordHash))) {
    throw new HttpError(401, "Credenciais inválidas");
  }

  const { active: _active, passwordHash: _passwordHash, ...sessionUser } = user;
  return sessionUser;
}
