import "server-only";

import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { MessageDirection } from "@/generated/prisma/enums";
import { formatContactPhone, resolveContactName } from "@/lib/contact-display";
import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/http";
import type { SessionUser } from "@/modules/auth/session";
import { parseMessageContent } from "@/modules/messages/content";
import {
  quotedReplyPreview,
  whatsappMessageIdSchema,
} from "@/modules/messages/reply-context";

import {
  conversationCursorSchema,
  conversationIdSchema,
  conversationListOptionsSchema,
  messageIdSchema,
} from "./schemas";
import type {
  ContactClassificationDto,
  ContactClassificationRecord,
  ContactDto,
  ConversationCursor,
  ConversationDetail,
  ConversationDetailRecord,
  ConversationListItem,
  ConversationListOptions,
  ConversationListRecord,
  ConversationListResult,
  PinnedConversationStateDto,
  ConversationReadDto,
  ConversationRepository,
  ConversationUserRecord,
  MessageDto,
  MessageRecord,
} from "./types";
import { toMediaStateDto } from "./types";

export const CONVERSATION_PAGE_SIZE = 50;

const userSelect = { id: true, name: true, active: true } as const;
const replyPreviewSelect = {
  id: true,
  direction: true,
  type: true,
  body: true,
  content: true,
  sentByUser: { select: userSelect },
  mediaObject: { select: { originalFilename: true } },
} as const;
const messageSelect = {
  id: true,
  clientRequestId: true,
  conversationId: true,
  whatsappMessageId: true,
  replyToWhatsappMessageId: true,
  replyToMessage: { select: replyPreviewSelect },
  direction: true,
  type: true,
  body: true,
  content: true,
  mediaObjectId: true,
  status: true,
  failureReason: true,
  revokedAt: true,
  externalTimestamp: true,
  createdAt: true,
  sentByUser: { select: userSelect },
  mediaObject: {
    select: {
      status: true,
      downloadLeaseUntil: true,
      downloadNextAttemptAt: true,
      downloadAttempts: true,
    },
  },
  reactions: {
    where: { emoji: { not: "" } },
    orderBy: { reactor: "desc" },
    select: {
      id: true,
      reactor: true,
      emoji: true,
      status: true,
      sentByUser: { select: userSelect },
    },
  },
} as const;
const classificationSelect = {
  id: true,
  displayName: true,
  color: true,
  position: true,
  active: true,
} as const;
const tagAssignmentOrderBy: Prisma.ContactTagAssignmentOrderByWithRelationInput[] = [
  { tag: { position: "asc" } },
  { tagId: "asc" },
];
const conversationSelect = {
  id: true,
  pinnedAt: true,
  lastMessageAt: true,
  createdAt: true,
  updatedAt: true,
  teamLastReadMessageId: true,
  teamLastReadAt: true,
  manualUnreadAt: true,
  awaitingResponseSince: true,
  teamLastReadMessage: {
    select: { id: true, externalTimestamp: true },
  },
  contact: {
    select: {
      id: true,
      name: true,
      preferredName: true,
      phone: true,
      whatsappAppContact: { select: { fullName: true, active: true } },
      contactType: { select: classificationSelect },
      tagAssignments: {
        orderBy: tagAssignmentOrderBy,
        select: { tag: { select: classificationSelect } },
      },
    },
  },
  responsibleUser: { select: userSelect },
} as const;

type PrismaConversationRepositoryClient = Pick<
  PrismaClient,
  "conversation" | "conversationRead" | "message" | "user"
>;

type BaseConversationRow = {
  id: string;
  pinnedAt: Date | null;
  lastMessageAt: Date;
  createdAt: Date;
  updatedAt: Date;
  contact: ConversationListRecord["contact"];
  responsibleUser: ConversationUserRecord | null;
  teamLastReadMessageId: string | null;
  teamLastReadAt: Date | null;
  manualUnreadAt: Date | null;
  awaitingResponseSince: Date | null;
  teamLastReadMessage: {
    id: string;
    externalTimestamp: Date;
  } | null;
};

function isPrismaError(
  error: unknown,
  code: string,
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}

function isRetryableConversationConflict(error: unknown): boolean {
  if (isPrismaError(error, "P2034")) {
    return true;
  }

  if (!isPrismaError(error, "P2010")) {
    return false;
  }

  const driverAdapterError = error.meta?.driverAdapterError;

  return (
    typeof driverAdapterError === "object" &&
    driverAdapterError !== null &&
    "cause" in driverAdapterError &&
    typeof driverAdapterError.cause === "object" &&
    driverAdapterError.cause !== null &&
    "kind" in driverAdapterError.cause &&
    driverAdapterError.cause.kind === "TransactionWriteConflict"
  );
}

export async function runConversationTransaction<TTransaction, TResult>(
  client: {
    $transaction<T>(
      operation: (transaction: TTransaction) => Promise<T>,
      options: { isolationLevel: Prisma.TransactionIsolationLevel },
    ): Promise<T>;
  },
  operation: (transaction: TTransaction) => Promise<TResult>,
): Promise<TResult> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await client.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (!isRetryableConversationConflict(error) || attempt === 2) {
        throw error;
      }
    }
  }

  throw new Error("Unreachable transaction state");
}

function messageOrder(left: MessageRecord, right: MessageRecord): number {
  return (
    left.externalTimestamp.getTime() - right.externalTimestamp.getTime() ||
    left.id.localeCompare(right.id)
  );
}

function toMessageDto(message: MessageRecord): MessageDto {
  const mediaState = message.mediaObject
    ? toMediaStateDto(message.mediaObject, new Date())
    : null;

  return {
    id: message.id,
    clientRequestId: message.clientRequestId ?? null,
    direction: message.direction,
    type: message.type,
    body: message.body,
    content: parseMessageContent(message.content),
    canReply: whatsappMessageIdSchema.safeParse(message.whatsappMessageId).success,
    replyTo: message.replyToMessage
      ? quotedReplyPreview({
          id: message.replyToMessage.id,
          direction: message.replyToMessage.direction,
          type: message.replyToMessage.type,
          body: message.replyToMessage.body,
          content: message.replyToMessage.content,
          sentBy: message.replyToMessage.sentByUser,
        })
      : message.replyToWhatsappMessageId
        ? { available: false }
        : null,
    mediaObjectId: message.mediaObjectId,
    mediaState,
    sentBy: message.sentByUser
      ? { id: message.sentByUser.id, name: message.sentByUser.name }
      : null,
    status: message.status,
    failureReason: message.failureReason,
    revokedAt: message.revokedAt?.toISOString() ?? null,
    reactions: [...message.reactions]
      .sort((left, right) => (
        (left.reactor === "CONTACT" ? 0 : 1) -
        (right.reactor === "CONTACT" ? 0 : 1)
      ))
      .map((reaction) => ({
        id: reaction.id,
        reactor: reaction.reactor,
        emoji: reaction.emoji,
        status: reaction.status,
        sentBy: reaction.sentByUser
          ? { id: reaction.sentByUser.id, name: reaction.sentByUser.name }
          : null,
      })),
    externalTimestamp: message.externalTimestamp.toISOString(),
    createdAt: message.createdAt.toISOString(),
  };
}

function toContactClassificationDto(
  definition: ContactClassificationRecord,
): ContactClassificationDto {
  return {
    id: definition.id,
    name: definition.displayName,
    color: definition.color,
    active: definition.active,
  };
}

function toContactDto(
  contact: ConversationListRecord["contact"],
): ContactDto {
  return {
    id: contact.id,
    profileName: contact.name,
    preferredName: contact.preferredName,
    whatsappAppName:
      contact.whatsappAppContact?.active === true
        ? contact.whatsappAppContact.fullName
        : null,
    name: resolveContactName({
      preferredName: contact.preferredName,
      whatsappAppName:
        contact.whatsappAppContact?.active === true
          ? contact.whatsappAppContact.fullName
          : null,
      profileName: contact.name,
      phone: contact.phone,
    }),
    phone: formatContactPhone(contact.phone),
    type: contact.contactType
      ? toContactClassificationDto(contact.contactType)
      : null,
    tags: [...contact.tagAssignments]
      .sort(
        (left, right) =>
          left.tag.position - right.tag.position ||
          left.tag.id.localeCompare(right.tag.id),
      )
      .map(({ tag }) => toContactClassificationDto(tag)),
  };
}

function toListItem(record: ConversationListRecord): ConversationListItem {
  return {
    id: record.id,
    contact: toContactDto(record.contact),
    responsible: record.responsibleUser
      ? { id: record.responsibleUser.id, name: record.responsibleUser.name }
      : null,
    pinnedAt: record.pinnedAt?.toISOString() ?? null,
    lastMessageAt: record.lastMessageAt.toISOString(),
    latestMessage: record.latestMessage
      ? toMessageDto(record.latestMessage)
      : null,
    unreadCount: record.unreadCount,
    manuallyUnread: record.manualUnreadAt !== null,
    manualUnreadRevision: record.manualUnreadAt?.toISOString() ?? null,
    awaitingResponseSince: record.awaitingResponseSince?.toISOString() ?? null,
    revision: record.updatedAt.toISOString(),
  };
}

function toDetail(record: ConversationDetailRecord): ConversationDetail {
  return {
    ...toListItem(record),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    messages: [...record.messages].sort(messageOrder).map(toMessageDto),
    lastReadMessageId: record.lastReadMessageId,
    lastReadAt: record.lastReadAt?.toISOString() ?? null,
  };
}

function toReadDto(read: {
  conversationId: string;
  lastReadMessageId: string | null;
  lastReadAt: Date;
}): ConversationReadDto {
  return {
    conversationId: read.conversationId,
    lastReadMessageId: read.lastReadMessageId,
    lastReadAt: read.lastReadAt.toISOString(),
  };
}

function encodeCursor(record: ConversationListRecord): string {
  return Buffer.from(
    JSON.stringify({
      pinnedAt: record.pinnedAt?.toISOString() ?? null,
      lastMessageAt: record.lastMessageAt.toISOString(),
      id: record.id,
    }),
  ).toString("base64url");
}

function decodeCursor(cursor: string): ConversationCursor {
  let decoded: unknown;

  try {
    decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new HttpError(400, "Cursor inválido");
  }

  const parsed = conversationCursorSchema.safeParse(decoded);

  if (!parsed.success) {
    throw new HttpError(400, "Cursor inválido");
  }

  return {
    pinnedAt: parsed.data.pinnedAt ? new Date(parsed.data.pinnedAt) : null,
    lastMessageAt: new Date(parsed.data.lastMessageAt),
    id: parsed.data.id,
  };
}

function cursorWhere(cursor?: ConversationCursor): Prisma.ConversationWhereInput {
  if (!cursor) {
    return {};
  }

  const messageBoundary: Prisma.ConversationWhereInput = {
    OR: [
      { lastMessageAt: { lt: cursor.lastMessageAt } },
      { lastMessageAt: cursor.lastMessageAt, id: { lt: cursor.id } },
    ],
  };

  if (!cursor.pinnedAt) {
    return { AND: [{ pinnedAt: null }, messageBoundary] };
  }

  return {
    OR: [
      { pinnedAt: null },
      { pinnedAt: { lt: cursor.pinnedAt } },
      { AND: [{ pinnedAt: cursor.pinnedAt }, messageBoundary] },
    ],
  };
}

function searchWhere(search?: string): Prisma.ConversationWhereInput {
  if (!search) {
    return {};
  }

  const canonicalPhoneSearch = search.replace(/\D/gu, "");
  const searchPredicates: Prisma.ContactWhereInput[] = [
    { preferredName: { contains: search, mode: "insensitive" } },
    { name: { contains: search, mode: "insensitive" } },
    {
      whatsappAppContact: {
        is: {
          active: true,
          fullName: { contains: search, mode: "insensitive" },
        },
      },
    },
  ];

  if (canonicalPhoneSearch && /^\+?[\d\s().-]+$/u.test(search)) {
    searchPredicates.push({ phone: { contains: canonicalPhoneSearch } });
  }

  return {
    contact: {
      is: {
        OR: searchPredicates,
      },
    },
  };
}

function classificationWhere(
  contactTypeId?: string,
  tagIds: string[] = [],
): Prisma.ConversationWhereInput {
  if (!contactTypeId && tagIds.length === 0) {
    return {};
  }

  return {
    contact: {
      is: {
        ...(contactTypeId ? { contactTypeId } : {}),
        ...(tagIds.length > 0
          ? {
              AND: tagIds.map((tagId) => ({
                tagAssignments: { some: { tagId } },
              })),
            }
          : {}),
      },
    },
  };
}

async function unreadCounts(
  client: PrismaConversationRepositoryClient,
  conversations: BaseConversationRow[],
): Promise<Map<string, number>> {
  if (conversations.length === 0) {
    return new Map();
  }

  const groups = await client.message.groupBy({
    by: ["conversationId"],
    where: {
      direction: MessageDirection.INBOUND,
      OR: conversations.map(({ id, teamLastReadAt, teamLastReadMessage }) => {
        if (!teamLastReadMessage) {
          return {
            conversationId: id,
            ...(teamLastReadAt
              ? { externalTimestamp: { gt: teamLastReadAt } }
              : {}),
          };
        }

        return {
          conversationId: id,
          OR: [
            {
              externalTimestamp: {
                gt: teamLastReadMessage.externalTimestamp,
              },
            },
            {
              externalTimestamp: teamLastReadMessage.externalTimestamp,
              id: { gt: teamLastReadMessage.id },
            },
          ],
        };
      }),
    },
    _count: { _all: true },
  });

  return new Map(groups.map((group) => [group.conversationId, group._count._all]));
}

export function createPrismaConversationRepository(
  client: PrismaConversationRepositoryClient,
): ConversationRepository {
  const repository: ConversationRepository = {
    async list(userId, query) {
      const rows = await client.conversation.findMany({
        where: {
          AND: [
            searchWhere(query.search),
            classificationWhere(query.contactTypeId, query.tagIds),
            cursorWhere(query.cursor),
          ],
        },
        orderBy: [
          { pinnedAt: { sort: "desc", nulls: "last" } },
          { lastMessageAt: "desc" },
          { id: "desc" },
        ],
        take: query.take,
        select: {
          ...conversationSelect,
          messages: {
            take: 1,
            orderBy: [{ externalTimestamp: "desc" }, { id: "desc" }],
            select: messageSelect,
          },
        },
      });
      const counts = await unreadCounts(client, rows);

      return rows.map(({ messages, teamLastReadMessage: _boundary, ...row }) => ({
        ...row,
        latestMessage: messages[0] ?? null,
        unreadCount: counts.get(row.id) ?? 0,
      }));
    },
    async findById(userId, id) {
      const row = await client.conversation.findUnique({
        where: { id },
        select: {
          ...conversationSelect,
          messages: {
            orderBy: [{ externalTimestamp: "asc" }, { id: "asc" }],
            select: messageSelect,
          },
        },
      });

      if (!row) {
        return null;
      }

      const counts = await unreadCounts(client, [row]);
      const { teamLastReadMessage: _boundary, ...base } = row;

      return {
        ...base,
        latestMessage: row.messages.at(-1) ?? null,
        unreadCount: counts.get(row.id) ?? 0,
        lastReadMessageId: row.teamLastReadMessageId,
        lastReadAt: row.teamLastReadAt,
      };
    },
    findMessage(messageId) {
      return client.message.findUnique({
        where: { id: messageId },
        select: messageSelect,
      });
    },
    findRead(userId, conversationId) {
      return client.conversationRead.findUnique({
        where: { conversationId_userId: { conversationId, userId } },
        select: {
          userId: true,
          conversationId: true,
          lastReadMessageId: true,
          lastReadAt: true,
          lastReadMessage: {
            select: { id: true, externalTimestamp: true },
          },
        },
      });
    },
    async upsertRead(userId, conversationId, messageId) {
      const target = await client.message.findUniqueOrThrow({
        where: { id: messageId },
        select: { externalTimestamp: true },
      });
      return client.conversationRead.upsert({
        where: { conversationId_userId: { conversationId, userId } },
        create: {
          conversationId,
          userId,
          lastReadMessageId: messageId,
          lastReadAt: target.externalTimestamp,
        },
        update: {
          lastReadMessageId: messageId,
          lastReadAt: target.externalTimestamp,
        },
        select: {
          userId: true,
          conversationId: true,
          lastReadMessageId: true,
          lastReadAt: true,
          lastReadMessage: {
            select: { id: true, externalTimestamp: true },
          },
        },
      });
    },
    findActiveUser(userId) {
      return client.user.findFirst({
        where: { id: userId, active: true },
        select: userSelect,
      });
    },
    async updateResponsible(conversationId, userId) {
      await client.conversation.update({
        where: { id: conversationId },
        data: { responsibleUserId: userId },
      });
    },
    findPinState(conversationId) {
      return client.conversation.findUnique({
        where: { id: conversationId },
        select: { id: true, pinnedAt: true, updatedAt: true },
      });
    },
    updatePinnedAt(conversationId, pinnedAt) {
      return client.conversation.update({
        where: { id: conversationId },
        data: { pinnedAt },
        select: { id: true, pinnedAt: true, updatedAt: true },
      });
    },
    transaction: async (operation) => operation(repository),
  };

  return repository;
}

const conversationRepository = createPrismaConversationRepository(prisma);
conversationRepository.transaction = (operation) =>
  runConversationTransaction(prisma, (transaction) =>
    operation(createPrismaConversationRepository(transaction)),
  );

export async function listConversations(
  userId: string,
  options: ConversationListOptions,
  repository: ConversationRepository = conversationRepository,
): Promise<ConversationListResult> {
  const parsedUserId = conversationIdSchema.parse(userId);
  const parsed = conversationListOptionsSchema.parse(options);
  const records = await repository.list(parsedUserId, {
    search: parsed.search,
    contactTypeId: parsed.contactTypeId,
    tagIds: parsed.tagIds,
    cursor: parsed.cursor ? decodeCursor(parsed.cursor) : undefined,
    take: CONVERSATION_PAGE_SIZE + 1,
  });
  const hasMore = records.length > CONVERSATION_PAGE_SIZE;
  const page = records.slice(0, CONVERSATION_PAGE_SIZE);

  return {
    items: page.map(toListItem),
    nextCursor: hasMore && page.length > 0 ? encodeCursor(page.at(-1)!) : null,
  };
}

export async function setConversationPinned(
  userId: string,
  conversationId: string,
  pinned: boolean,
  repository: ConversationRepository = conversationRepository,
  now: () => Date = () => new Date(),
): Promise<PinnedConversationStateDto> {
  conversationIdSchema.parse(userId);
  const parsedConversationId = conversationIdSchema.parse(conversationId);

  return repository.transaction(async (transaction) => {
    const current = await transaction.findPinState(parsedConversationId);
    if (!current) throw new HttpError(404, "Conversa não encontrada");

    const matchesRequestedState = (current.pinnedAt !== null) === pinned;
    const persisted = matchesRequestedState
      ? current
      : await transaction.updatePinnedAt(
          parsedConversationId,
          pinned ? now() : null,
        );

    return {
      conversationId: persisted.id,
      pinnedAt: persisted.pinnedAt?.toISOString() ?? null,
      revision: persisted.updatedAt.toISOString(),
    };
  });
}

export async function getConversation(
  userId: string,
  id: string,
  repository: ConversationRepository = conversationRepository,
): Promise<ConversationDetail> {
  const parsedUserId = conversationIdSchema.parse(userId);
  const parsedId = conversationIdSchema.parse(id);
  const conversation = await repository.findById(parsedUserId, parsedId);

  if (!conversation) {
    throw new HttpError(404, "Conversa não encontrada");
  }

  return toDetail(conversation);
}

export async function markRead(
  userId: string,
  id: string,
  messageId: string,
  repository: ConversationRepository = conversationRepository,
): Promise<ConversationReadDto> {
  const parsedUserId = conversationIdSchema.parse(userId);
  const parsedId = conversationIdSchema.parse(id);
  const parsedMessageId = messageIdSchema.parse(messageId);

  return repository.transaction(async (transaction) => {
    const message = await transaction.findMessage(parsedMessageId);

    if (!message || message.conversationId !== parsedId) {
      throw new HttpError(400, "Mensagem não pertence à conversa");
    }

    const current = await transaction.findRead(parsedUserId, parsedId);

    if (current) {
      const boundary = current.lastReadMessage;
      const advancesBoundary = boundary
        ? message.externalTimestamp > boundary.externalTimestamp ||
          (message.externalTimestamp.getTime() ===
            boundary.externalTimestamp.getTime() && message.id > boundary.id)
        : message.externalTimestamp > current.lastReadAt;

      if (!advancesBoundary) {
        return toReadDto(current);
      }
    }

    return toReadDto(
      await transaction.upsertRead(parsedUserId, parsedId, parsedMessageId),
    );
  });
}

export async function setResponsible(
  actor: SessionUser,
  id: string,
  userId: string | null,
  repository: ConversationRepository = conversationRepository,
): Promise<ConversationDetail> {
  const parsedActorId = conversationIdSchema.parse(actor.id);
  const parsedId = conversationIdSchema.parse(id);
  const parsedUserId = userId === null ? null : conversationIdSchema.parse(userId);

  return repository.transaction(async (transaction) => {
    if (!(await transaction.findById(parsedActorId, parsedId))) {
      throw new HttpError(404, "Conversa não encontrada");
    }

    if (parsedUserId && !(await transaction.findActiveUser(parsedUserId))) {
      throw new HttpError(400, "Responsável deve ser um usuário ativo");
    }

    await transaction.updateResponsible(parsedId, parsedUserId);
    const committed = await transaction.findById(parsedActorId, parsedId);

    if (!committed) {
      throw new HttpError(404, "Conversa não encontrada");
    }

    return toDetail(committed);
  });
}
