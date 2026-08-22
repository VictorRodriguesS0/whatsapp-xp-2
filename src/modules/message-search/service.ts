import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { parseMessageContent } from "@/modules/messages/content";
import { toMediaStateDto, type MessageDto } from "@/modules/conversations/types";

import { normalizeSearchText } from "./text";
import type {
  ConversationMessageSearchInput,
  ConversationMessageSearchPage,
  MessageContextDto,
  MessageSearchCursor,
  MessageSearchInput,
  MessageSearchPage,
  MessageSearchQuery,
  MessageSearchRecord,
  MessageSearchRepository,
  MessageSearchResultDto,
} from "./types";

const cursorSchema = {
  parse(value: unknown): MessageSearchCursor {
    if (!value || typeof value !== "object") throw new Error("Invalid cursor");
    const candidate = value as Record<string, unknown>;
    if (
      typeof candidate.externalTimestamp !== "string" ||
      !Number.isFinite(Date.parse(candidate.externalTimestamp)) ||
      typeof candidate.id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(candidate.id)
    ) throw new Error("Invalid cursor");
    return { externalTimestamp: candidate.externalTimestamp, id: candidate.id };
  },
};

function decodeCursor(cursor?: string): MessageSearchCursor | null {
  if (!cursor) return null;
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
  } catch {
    throw new HttpError(400, "Cursor inválido");
  }
}

function encodeCursor(record: MessageSearchRecord): string {
  return Buffer.from(JSON.stringify({
    externalTimestamp: record.externalTimestamp.toISOString(),
    id: record.messageId,
  })).toString("base64url");
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, (character) => `\\${character}`);
}

function snippet(searchText: string, query: string): string {
  const index = searchText.indexOf(query);
  if (index < 0 || searchText.length <= 180) return searchText.slice(0, 180);
  const start = Math.max(0, index - 70);
  const end = Math.min(searchText.length, index + query.length + 110);
  return `${start > 0 ? "…" : ""}${searchText.slice(start, end)}${end < searchText.length ? "…" : ""}`;
}

function toResult(record: MessageSearchRecord, query: string): MessageSearchResultDto {
  return {
    messageId: record.messageId,
    conversationId: record.conversationId,
    direction: record.direction,
    type: record.type,
    externalTimestamp: record.externalTimestamp.toISOString(),
    snippet: snippet(record.searchText, query),
    matchedText: query,
    contact: {
      id: record.contactId,
      name: record.contactPreferredName || record.contactName,
      phone: record.contactPhone ?? "",
    },
  };
}

type ContextMessage = Prisma.MessageGetPayload<{
  include: { sentByUser: { select: { id: true; name: true } }; mediaObject: true };
}>;

function contextMessageDto(message: ContextMessage, now: Date): MessageDto {
  return {
    id: message.id,
    clientRequestId: message.clientRequestId,
    direction: message.direction,
    type: message.type,
    body: message.body,
    content: parseMessageContent(message.content),
    mediaObjectId: message.mediaObjectId,
    mediaState: message.mediaObject ? toMediaStateDto(message.mediaObject, now) : null,
    sentBy: message.sentByUser,
    status: message.status,
    failureReason: message.failureReason,
    externalTimestamp: message.externalTimestamp.toISOString(),
    createdAt: message.createdAt.toISOString(),
  };
}

export const prismaMessageSearchRepository: MessageSearchRepository = {
  findActiveUser(actorId) {
    return prisma.user.findFirst({ where: { id: actorId, active: true }, select: { id: true } });
  },
  search(query) {
    const pattern = `%${escapeLike(query.query)}%`;
    const conversation = query.conversationId
      ? Prisma.sql`AND m.conversation_id = ${query.conversationId}::uuid`
      : Prisma.empty;
    const cursor = query.cursor
      ? Prisma.sql`AND (m.external_timestamp, m.id) < (${new Date(query.cursor.externalTimestamp)}, ${query.cursor.id}::uuid)`
      : Prisma.empty;
    return prisma.$queryRaw<MessageSearchRecord[]>(Prisma.sql`
      SELECT
        m.id AS "messageId",
        m.conversation_id AS "conversationId",
        m.direction,
        m.type,
        m.external_timestamp AS "externalTimestamp",
        m.search_text AS "searchText",
        c.id AS "contactId",
        c.name AS "contactName",
        c.preferred_name AS "contactPreferredName",
        c.phone AS "contactPhone"
      FROM messages m
      JOIN conversations conversation ON conversation.id = m.conversation_id
      JOIN contacts c ON c.id = conversation.contact_id
      WHERE m.search_text ILIKE ${pattern} ESCAPE '\\'
      ${conversation}
      ${cursor}
      ORDER BY m.external_timestamp DESC, m.id DESC
      LIMIT ${query.take}
    `);
  },
  async loadContext(conversationId, messageId) {
    const target = await prisma.message.findFirst({
      where: { id: messageId, conversationId },
      include: { sentByUser: { select: { id: true, name: true } }, mediaObject: true },
    });
    if (!target) return null;
    const boundary = {
      OR: [
        { externalTimestamp: { lt: target.externalTimestamp } },
        { externalTimestamp: target.externalTimestamp, id: { lt: target.id } },
      ],
    };
    const afterBoundary = {
      OR: [
        { externalTimestamp: { gt: target.externalTimestamp } },
        { externalTimestamp: target.externalTimestamp, id: { gt: target.id } },
      ],
    };
    const include = { sentByUser: { select: { id: true, name: true } }, mediaObject: true } as const;
    const [before, after] = await Promise.all([
      prisma.message.findMany({ where: { conversationId, ...boundary }, orderBy: [{ externalTimestamp: "desc" }, { id: "desc" }], take: 20, include }),
      prisma.message.findMany({ where: { conversationId, ...afterBoundary }, orderBy: [{ externalTimestamp: "asc" }, { id: "asc" }], take: 20, include }),
    ]);
    const now = new Date();
    return {
      conversationId,
      targetMessageId: messageId,
      messages: [...before.reverse(), target, ...after].map((message) => contextMessageDto(message, now)),
    };
  },
};

async function ensureActive(actorId: string, repository: MessageSearchRepository): Promise<void> {
  if (!await repository.findActiveUser(actorId)) throw new HttpError(403, "Acesso negado");
}

async function executeSearch(
  actorId: string,
  input: MessageSearchInput,
  conversationId: string | null,
  repository: MessageSearchRepository,
): Promise<MessageSearchPage> {
  await ensureActive(actorId, repository);
  const query = normalizeSearchText([input.query]);
  if (query.length < 2 || query.length > 120) throw new HttpError(400, "Pesquisa inválida");
  const take = Math.min(Math.max(input.take ?? 20, 1), 50);
  const records = await repository.search({ query, take: take + 1, cursor: decodeCursor(input.cursor), conversationId });
  const hasMore = records.length > take;
  const page = records.slice(0, take);
  return {
    items: page.map((record) => toResult(record, query)),
    nextCursor: hasMore && page.length > 0 ? encodeCursor(page[page.length - 1]) : null,
  };
}

export function searchMessages(
  actorId: string,
  input: MessageSearchInput,
  repository: MessageSearchRepository = prismaMessageSearchRepository,
): Promise<MessageSearchPage> {
  return executeSearch(actorId, input, null, repository);
}

export function searchConversationMessages(
  actorId: string,
  conversationId: string,
  input: ConversationMessageSearchInput,
  repository: MessageSearchRepository = prismaMessageSearchRepository,
): Promise<ConversationMessageSearchPage> {
  return executeSearch(actorId, input, conversationId, repository);
}

export async function loadMessageContext(
  actorId: string,
  conversationId: string,
  messageId: string,
  repository: MessageSearchRepository = prismaMessageSearchRepository,
): Promise<MessageContextDto> {
  await ensureActive(actorId, repository);
  const context = await repository.loadContext(conversationId, messageId);
  if (!context) throw new HttpError(404, "Mensagem não encontrada");
  return context;
}
