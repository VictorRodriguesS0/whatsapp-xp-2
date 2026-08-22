import "server-only";

import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { z } from "zod";

export type QuickReplyRecord = {
  id: string;
  shortcut: string;
  message: string;
  position: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type QuickReplyDto = Pick<QuickReplyRecord, "id" | "shortcut" | "message" | "position" | "active">;

type QuickReplyCreateData = Pick<QuickReplyRecord, "shortcut" | "message" | "position" | "active">;
type QuickReplyUpdateData = Partial<Pick<QuickReplyRecord, "shortcut" | "message" | "active">>;

export type QuickReplyRepository = {
  list(activeOnly: boolean): Promise<QuickReplyRecord[]>;
  findById(id: string): Promise<QuickReplyRecord | null>;
  create(data: QuickReplyCreateData): Promise<QuickReplyRecord>;
  update(id: string, data: QuickReplyUpdateData): Promise<QuickReplyRecord>;
};

export class QuickReplyValidationError extends Error {
  override name = "QuickReplyValidationError";
}

export class QuickReplyConflictError extends Error {
  override name = "QuickReplyConflictError";
  constructor() { super("Atalho já cadastrado"); }
}

export class QuickReplyNotFoundError extends Error {
  override name = "QuickReplyNotFoundError";
  constructor() { super("Resposta rápida não encontrada"); }
}

export function normalizeQuickReplyShortcut(value: string): string {
  return value.normalize("NFKC").trim().replace(/^\/+/, "").toLowerCase();
}

const shortcutSchema = z.string().transform(normalizeQuickReplyShortcut).pipe(
  z.string().min(1).max(40).regex(/^[a-z0-9_-]+$/),
);
const messageSchema = z.string().trim().min(1).max(4_096);
const createSchema = z.object({ shortcut: shortcutSchema, message: messageSchema }).strict();
const updateSchema = z.object({
  shortcut: shortcutSchema.optional(),
  message: messageSchema.optional(),
  active: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0);
const idSchema = z.string().uuid();

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new QuickReplyValidationError("Dados da resposta rápida inválidos");
  return result.data;
}

function dto(record: QuickReplyRecord): QuickReplyDto {
  const { id, shortcut, message, position, active } = record;
  return { id, shortcut, message, position, active };
}

function mapDatabaseError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") throw new QuickReplyConflictError();
    if (error.code === "P2025") throw new QuickReplyNotFoundError();
  }
  throw error;
}

export function createPrismaQuickReplyRepository(client: PrismaClient): QuickReplyRepository {
  const select = { id: true, shortcut: true, message: true, position: true, active: true, createdAt: true, updatedAt: true } as const;
  return {
    list: (activeOnly) => client.quickReply.findMany({
      where: activeOnly ? { active: true } : undefined,
      orderBy: [{ position: "asc" }, { shortcut: "asc" }, { id: "asc" }],
      select,
    }),
    findById: (id) => client.quickReply.findUnique({ where: { id }, select }),
    create: (data) => client.quickReply.create({ data, select }),
    update: (id, data) => client.quickReply.update({ where: { id }, data, select }),
  };
}

const defaultRepository = createPrismaQuickReplyRepository(prisma);

export async function listQuickReplies(
  options: { activeOnly?: boolean } = {},
  repository: QuickReplyRepository = defaultRepository,
): Promise<QuickReplyDto[]> {
  return (await repository.list(options.activeOnly === true)).map(dto);
}

export async function createQuickReply(
  input: unknown,
  repository: QuickReplyRepository = defaultRepository,
): Promise<QuickReplyDto> {
  const parsed = parse(createSchema, input);
  const current = await repository.list(false);
  const position = current.reduce((maximum, item) => Math.max(maximum, item.position), 0) + 10;
  try {
    return dto(await repository.create({ ...parsed, position, active: true }));
  } catch (error) {
    if (error instanceof QuickReplyConflictError) throw error;
    mapDatabaseError(error);
  }
}

export async function updateQuickReply(
  id: string,
  input: unknown,
  repository: QuickReplyRepository = defaultRepository,
): Promise<QuickReplyDto> {
  const validId = parse(idSchema, id);
  const parsed = parse(updateSchema, input);
  if (!(await repository.findById(validId))) throw new QuickReplyNotFoundError();
  try {
    return dto(await repository.update(validId, parsed));
  } catch (error) {
    if (error instanceof QuickReplyConflictError || error instanceof QuickReplyNotFoundError) throw error;
    mapDatabaseError(error);
  }
}
