import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { UserRole } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { requireAdmin } from "@/modules/auth/guards";
import { hashPassword } from "@/modules/auth/password";
import type { SessionUser } from "@/modules/auth/session";

import {
  createUserSchema,
  resetUserPasswordSchema,
  updateUserSchema,
  userIdSchema,
} from "./schemas";
import type {
  CreateUserData,
  PublicUser,
  UpdateUserData,
  UserRecord,
  UserRepository,
} from "./types";

const userRepository: UserRepository = {
  list: () => prisma.user.findMany({ orderBy: { name: "asc" } }),
  findById: (id) => prisma.user.findUnique({ where: { id } }),
  findByEmail: (email) => prisma.user.findUnique({ where: { email } }),
  countActiveAdmins: () =>
    prisma.user.count({ where: { active: true, role: UserRole.ADMIN } }),
  create: (data) => prisma.user.create({ data }),
  update: (id, data) => prisma.user.update({ where: { id }, data }),
  deleteSessions: async (userId) => {
    await prisma.session.deleteMany({ where: { userId } });
  },
};

function toPublicUser({ passwordHash: _passwordHash, ...user }: UserRecord): PublicUser {
  return user;
}

function isPrismaError(error: unknown, code: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}

function rethrowDatabaseError(error: unknown): never {
  if (isPrismaError(error, "P2002")) {
    throw new HttpError(409, "E-mail já cadastrado");
  }

  if (isPrismaError(error, "P2025")) {
    throw new HttpError(404, "Usuário não encontrado");
  }

  throw error;
}

async function requireExistingUser(
  id: string,
  repository: UserRepository,
): Promise<UserRecord> {
  const user = await repository.findById(id);

  if (!user) {
    throw new HttpError(404, "Usuário não encontrado");
  }

  return user;
}

async function ensureUniqueEmail(
  email: string,
  repository: UserRepository,
  userId?: string,
): Promise<void> {
  const existing = await repository.findByEmail(email);

  if (existing && existing.id !== userId) {
    throw new HttpError(409, "E-mail já cadastrado");
  }
}

async function ensureActiveAdminRemains(
  user: UserRecord,
  data: UpdateUserData,
  repository: UserRepository,
): Promise<void> {
  const removesActiveAdmin =
    user.active &&
    user.role === UserRole.ADMIN &&
    (data.active === false || data.role === UserRole.ATTENDANT);

  if (removesActiveAdmin && (await repository.countActiveAdmins()) <= 1) {
    throw new HttpError(409, "Não é possível desativar o último administrador ativo");
  }
}

export async function listUsers(
  actor: SessionUser,
  repository: UserRepository = userRepository,
): Promise<PublicUser[]> {
  await requireAdmin(async () => actor);
  return (await repository.list()).map(toPublicUser);
}

export async function createUser(
  actor: SessionUser,
  input: unknown,
  repository: UserRepository = userRepository,
): Promise<PublicUser> {
  await requireAdmin(async () => actor);
  const parsed = createUserSchema.parse(input);
  await ensureUniqueEmail(parsed.email, repository);

  const data: CreateUserData = {
    name: parsed.name,
    email: parsed.email,
    role: parsed.role,
    passwordHash: await hashPassword(parsed.password),
  };

  try {
    return toPublicUser(await repository.create(data));
  } catch (error) {
    return rethrowDatabaseError(error);
  }
}

export async function updateUser(
  actor: SessionUser,
  id: string,
  input: unknown,
  repository: UserRepository = userRepository,
): Promise<PublicUser> {
  await requireAdmin(async () => actor);
  const parsedId = userIdSchema.parse(id);
  const parsed = updateUserSchema.parse(input);
  const current = await requireExistingUser(parsedId, repository);

  if (parsed.email) {
    await ensureUniqueEmail(parsed.email, repository, parsedId);
  }

  await ensureActiveAdminRemains(current, parsed, repository);

  try {
    const user = await repository.update(parsedId, parsed);

    if (parsed.active === false) {
      await repository.deleteSessions(parsedId);
    }

    return toPublicUser(user);
  } catch (error) {
    return rethrowDatabaseError(error);
  }
}

export async function resetUserPassword(
  actor: SessionUser,
  id: string,
  password: unknown,
  repository: UserRepository = userRepository,
): Promise<PublicUser> {
  await requireAdmin(async () => actor);
  const parsedId = userIdSchema.parse(id);
  const { password: parsedPassword } = resetUserPasswordSchema.parse({ password });
  await requireExistingUser(parsedId, repository);

  try {
    const user = await repository.update(parsedId, {
      passwordHash: await hashPassword(parsedPassword),
    });
    await repository.deleteSessions(parsedId);
    return toPublicUser(user);
  } catch (error) {
    return rethrowDatabaseError(error);
  }
}
