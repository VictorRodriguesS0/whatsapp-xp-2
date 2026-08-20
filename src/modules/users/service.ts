import "server-only";

import { Prisma, type PrismaClient } from "@/generated/prisma/client";
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

type PrismaUserRepositoryClient = Pick<PrismaClient, "user" | "session">;

export type SerializableTransactionClient<TTransaction = undefined> = {
  $transaction<TResult>(
    operation: (transaction: TTransaction) => Promise<TResult>,
    options: { isolationLevel: Prisma.TransactionIsolationLevel },
  ): Promise<TResult>;
};

function isPrismaError(error: unknown, code: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}

export async function runSerializableTransaction<TTransaction, TResult>(
  client: SerializableTransactionClient<TTransaction>,
  operation: (transaction: TTransaction) => Promise<TResult>,
): Promise<TResult> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await client.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (!isPrismaError(error, "P2034") || attempt === 2) {
        throw error;
      }
    }
  }

  throw new Error("Unreachable transaction state");
}

function createPrismaUserRepository(
  client: PrismaUserRepositoryClient,
): UserRepository {
  const repository: UserRepository = {
    list: () => client.user.findMany({ orderBy: { name: "asc" } }),
    findById: (id) => client.user.findUnique({ where: { id } }),
    findByEmail: (email) => client.user.findUnique({ where: { email } }),
    countActiveAdmins: () =>
      client.user.count({ where: { active: true, role: UserRole.ADMIN } }),
    create: (data) => client.user.create({ data }),
    update: (id, data) => client.user.update({ where: { id }, data }),
    deleteSessions: async (userId) => {
      await client.session.deleteMany({ where: { userId } });
    },
    transaction: async (operation) => operation(repository),
  };

  return repository;
}

const userRepository = createPrismaUserRepository(prisma);

userRepository.transaction = (operation) =>
  runSerializableTransaction(
    prisma,
    (transaction) => operation(createPrismaUserRepository(transaction)),
  );

function toPublicUser({ passwordHash: _passwordHash, ...user }: UserRecord): PublicUser {
  return user;
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

async function runTransaction<T>(
  repository: UserRepository,
  operation: (repository: UserRepository) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await repository.transaction(operation);
    } catch (error) {
      if (!isPrismaError(error, "P2034") || attempt === 2) {
        return rethrowDatabaseError(error);
      }
    }
  }

  throw new Error("Unreachable transaction state");
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

  return runTransaction(repository, async (transaction) => {
    const current = await requireExistingUser(parsedId, transaction);

    if (parsed.email) {
      await ensureUniqueEmail(parsed.email, transaction, parsedId);
    }

    await ensureActiveAdminRemains(current, parsed, transaction);

    try {
      const user = await transaction.update(parsedId, parsed);

      if (parsed.active === false) {
        await transaction.deleteSessions(parsedId);
      }

      return toPublicUser(user);
    } catch (error) {
      return rethrowDatabaseError(error);
    }
  });
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
  const passwordHash = await hashPassword(parsedPassword);

  return runTransaction(repository, async (transaction) => {
    await requireExistingUser(parsedId, transaction);

    try {
      const user = await transaction.update(parsedId, { passwordHash });
      await transaction.deleteSessions(parsedId);
      return toPublicUser(user);
    } catch (error) {
      return rethrowDatabaseError(error);
    }
  });
}
