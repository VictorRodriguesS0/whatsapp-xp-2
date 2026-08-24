import "server-only";

import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import {
  ConversationResumptionStatus,
  MessageDirection,
  MessageOperationalState,
  MessageStatus,
  WhatsAppPolicyMode,
  WhatsAppTemplateFunction,
} from "@/generated/prisma/enums";
import { formatContactPhone, resolveContactName } from "@/lib/contact-display";
import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/http";
import type { SessionUser } from "@/modules/auth/session";
import { parseMessageContent } from "@/modules/messages/content";
import {
  deriveServiceWindowDto,
  isConfirmingCurrentResumption,
  preparedAttemptBlocksResumption,
  resolveServiceResumptionTemplate,
  type MessagingPolicyRecord,
} from "@/modules/messaging-policy/service";
import {
  quotedReplyPreview,
  whatsappMessageIdSchema,
} from "@/modules/messages/reply-context";
import {
  renderServiceResumption,
  resolveServiceResumptionContactName,
} from "@/modules/templates/analysis";

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
  ServiceWindowPolicyContext,
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
      mimeType: true,
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
const confirmingResumptionStatuses: ConversationResumptionStatus[] = [
  ConversationResumptionStatus.RESERVED,
  ConversationResumptionStatus.SEND_IN_FLIGHT,
  ConversationResumptionStatus.OUTCOME_UNKNOWN,
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
  lastCustomerMessageAt: true,
  lastCustomerMessageId: true,
  pendingCustomerMessageId: true,
  awaitingCustomerSince: true,
  resumptions: {
    where: {
      status: {
        in: confirmingResumptionStatuses,
      },
    },
    orderBy: { createdAt: "desc" },
    take: 1,
    select: {
      clientRequestId: true,
      sourceMessageId: true,
      status: true,
      reservationUntil: true,
    },
  },
  teamLastReadMessage: {
    select: { id: true, externalTimestamp: true },
  },
  contact: {
    select: {
      id: true,
      name: true,
      preferredName: true,
      phone: true,
      messagingOptOutAt: true,
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
  | "conversation"
  | "conversationRead"
  | "message"
  | "user"
  | "whatsAppPolicyConfiguration"
  | "whatsAppTemplateAssignment"
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
  lastCustomerMessageAt: Date | null;
  lastCustomerMessageId: string | null;
  pendingCustomerMessageId: string | null;
  awaitingCustomerSince: Date | null;
  resumptions: Array<{
    clientRequestId: string;
    sourceMessageId: string;
    status: ConversationResumptionStatus;
    reservationUntil: Date | null;
  }>;
  teamLastReadMessage: {
    id: string;
    externalTimestamp: Date;
  } | null;
};

type PreparedAttemptRow = {
  clientRequestId: string | null;
  status: MessageStatus;
  operationalState: MessageOperationalState;
  providerAttemptedAt: Date | null;
};

async function preparedAttemptRequests(
  client: PrismaConversationRepositoryClient,
  rows: BaseConversationRow[],
): Promise<Set<string>> {
  const requestIds = [...new Set(rows.flatMap((row) =>
    (row.resumptions ?? [])
      .filter(({ status }) => status === ConversationResumptionStatus.RESERVED)
      .map(({ clientRequestId }) => clientRequestId),
  ))];
  if (requestIds.length === 0) return new Set();
  const attempts = await client.message.findMany({
    where: { clientRequestId: { in: requestIds } },
    select: {
      clientRequestId: true,
      status: true,
      operationalState: true,
      providerAttemptedAt: true,
    },
  }) as PreparedAttemptRow[];
  return new Set(
    attempts
      .filter((attempt) => preparedAttemptBlocksResumption(attempt))
      .flatMap(({ clientRequestId }) => clientRequestId ? [clientRequestId] : []),
  );
}

function withPreparedAttemptState(
  resumptions: BaseConversationRow["resumptions"],
  blockingRequests: Set<string>,
) {
  return resumptions.map((candidate) => ({
    sourceMessageId: candidate.sourceMessageId,
    status: candidate.status,
    reservationUntil: candidate.reservationUntil,
    hasBlockingAttempt: blockingRequests.has(candidate.clientRequestId),
  }));
}

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
    mediaMimeType: message.mediaObject?.mimeType ?? null,
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
    messagingRestricted: contact.messagingOptOutAt !== null,
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

function toServiceWindow(
  record: ConversationListRecord,
  policy: ServiceWindowPolicyContext,
  now: Date,
) {
  const template = policy.resumptionTemplate;
  const messagingPolicyRecord: MessagingPolicyRecord = {
    enforcement: policy.enforcement,
    lastCustomerMessageAt: record.lastCustomerMessageAt,
    pendingCustomerMessageId: record.pendingCustomerMessageId,
    awaitingCustomerSince: record.awaitingCustomerSince,
    confirmingResumption: isConfirmingCurrentResumption(
      record.lastCustomerMessageId,
      record.confirmingResumptions,
      now,
    ),
    messagingOptOutAt: record.contact.messagingOptOutAt,
    resumptionTemplate: template
      ? {
          templateName: template.templateName,
          language: template.language,
          previewBody: renderServiceResumption(
            template.bodyText,
            resolveServiceResumptionContactName({
              preferredName: record.contact.preferredName,
              whatsappAppName:
                record.contact.whatsappAppContact?.fullName ?? null,
              whatsappAppActive:
                record.contact.whatsappAppContact?.active === true,
              profileName: record.contact.name,
            }),
          ),
        }
      : null,
  };
  return deriveServiceWindowDto(messagingPolicyRecord, now);
}

function toListItem(
  record: ConversationListRecord,
  policy: ServiceWindowPolicyContext,
  now: Date,
): ConversationListItem {
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
    revision: record.updatedAt.toISOString(),
    serviceWindow: toServiceWindow(record, policy, now),
  };
}

function toDetail(
  record: ConversationDetailRecord,
  policy: ServiceWindowPolicyContext,
  now: Date,
): ConversationDetail {
  return {
    ...toListItem(record, policy, now),
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
    async getServiceWindowPolicyContext(now) {
      const [configuration, assignment] = await Promise.all([
        client.whatsAppPolicyConfiguration.findUnique({
          where: { id: 1 },
          select: {
            mode: true,
            lastTemplateSyncStatus: true,
            lastTemplateSyncSucceededAt: true,
          },
        }),
        client.whatsAppTemplateAssignment.findUnique({
          where: { function: WhatsAppTemplateFunction.SERVICE_RESUMPTION },
          select: {
            template: {
              select: {
                name: true,
                language: true,
                status: true,
                supported: true,
                parameterCount: true,
                bodyText: true,
                syncedAt: true,
              },
            },
          },
        }),
      ]);
      return {
        enforcement:
          configuration?.mode === WhatsAppPolicyMode.ACTIVE
            ? "ACTIVE"
            : "INACTIVE",
        resumptionTemplate: resolveServiceResumptionTemplate(
          configuration,
          assignment?.template ?? null,
          now,
        ),
      };
    },
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
      const blockingRequests = await preparedAttemptRequests(client, rows);

      return rows.map(({
        messages,
        resumptions,
        teamLastReadMessage: _boundary,
        ...row
      }) => ({
        ...row,
        confirmingResumptions: withPreparedAttemptState(
          resumptions ?? [],
          blockingRequests,
        ),
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
      const blockingRequests = await preparedAttemptRequests(client, [row]);
      const {
        resumptions,
        teamLastReadMessage: _boundary,
        ...base
      } = row;

      return {
        ...base,
        confirmingResumptions: withPreparedAttemptState(
          resumptions ?? [],
          blockingRequests,
        ),
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
  now: () => Date = () => new Date(),
): Promise<ConversationListResult> {
  const parsedUserId = conversationIdSchema.parse(userId);
  const parsed = conversationListOptionsSchema.parse(options);
  const currentTime = now();
  const [records, policy] = await Promise.all([
    repository.list(parsedUserId, {
      search: parsed.search,
      contactTypeId: parsed.contactTypeId,
      tagIds: parsed.tagIds,
      cursor: parsed.cursor ? decodeCursor(parsed.cursor) : undefined,
      take: CONVERSATION_PAGE_SIZE + 1,
    }),
    repository.getServiceWindowPolicyContext(currentTime),
  ]);
  const hasMore = records.length > CONVERSATION_PAGE_SIZE;
  const page = records.slice(0, CONVERSATION_PAGE_SIZE);

  return {
    items: page.map((record) => toListItem(record, policy, currentTime)),
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
  now: () => Date = () => new Date(),
): Promise<ConversationDetail> {
  const parsedUserId = conversationIdSchema.parse(userId);
  const parsedId = conversationIdSchema.parse(id);
  const currentTime = now();
  const [conversation, policy] = await Promise.all([
    repository.findById(parsedUserId, parsedId),
    repository.getServiceWindowPolicyContext(currentTime),
  ]);

  if (!conversation) {
    throw new HttpError(404, "Conversa não encontrada");
  }

  return toDetail(conversation, policy, currentTime);
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
  now: () => Date = () => new Date(),
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
    const currentTime = now();
    const [committed, policy] = await Promise.all([
      transaction.findById(parsedActorId, parsedId),
      transaction.getServiceWindowPolicyContext(currentTime),
    ]);

    if (!committed) {
      throw new HttpError(404, "Conversa não encontrada");
    }

    return toDetail(committed, policy, currentTime);
  });
}
