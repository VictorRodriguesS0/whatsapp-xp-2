import type {
  MessageDirection,
  MessageStatus,
  MessageType,
} from "@/generated/prisma/enums";

export type ConversationUserRecord = {
  id: string;
  name: string;
  active?: boolean;
};

export type ContactDto = {
  id: string;
  name: string;
  phone: string | null;
  profilePictureUrl: string | null;
};

export type ResponsibleUserDto = Pick<ConversationUserRecord, "id" | "name">;

export type MessageRecord = {
  id: string;
  clientRequestId?: string | null;
  conversationId: string;
  direction: MessageDirection;
  type: MessageType;
  body: string | null;
  mediaObjectId: string | null;
  sentByUser: ConversationUserRecord | null;
  status: MessageStatus;
  failureReason: string | null;
  externalTimestamp: Date;
  createdAt: Date;
};

export type MessageDto = {
  id: string;
  clientRequestId?: string | null;
  direction: MessageDirection;
  type: MessageType;
  body: string | null;
  mediaObjectId: string | null;
  sentBy: ResponsibleUserDto | null;
  status: MessageStatus;
  failureReason: string | null;
  externalTimestamp: string;
  createdAt: string;
};

export type ConversationListRecord = {
  id: string;
  contact: ContactDto;
  responsibleUser: ConversationUserRecord | null;
  lastMessageAt: Date;
  createdAt: Date;
  updatedAt: Date;
  latestMessage: MessageRecord | null;
  unreadCount: number;
  teamLastReadMessageId: string | null;
  teamLastReadAt: Date | null;
  manualUnreadAt: Date | null;
  awaitingResponseSince: Date | null;
};

export type ConversationDetailRecord = ConversationListRecord & {
  messages: MessageRecord[];
  lastReadMessageId: string | null;
  lastReadAt: Date | null;
};

export type ConversationListItem = {
  id: string;
  contact: ContactDto;
  responsible: ResponsibleUserDto | null;
  lastMessageAt: string;
  latestMessage: MessageDto | null;
  unreadCount: number;
  manuallyUnread: boolean;
  manualUnreadRevision: string | null;
  awaitingResponseSince: string | null;
  revision: string;
};

export type ConversationDetail = ConversationListItem & {
  createdAt: string;
  updatedAt: string;
  messages: MessageDto[];
  lastReadMessageId: string | null;
  lastReadAt: string | null;
};

export type ConversationCursor = {
  lastMessageAt: Date;
  id: string;
};

export type ConversationListOptions = {
  search?: string;
  cursor?: string;
};

export type ConversationListResult = {
  items: ConversationListItem[];
  nextCursor: string | null;
};

export type ConversationListQuery = {
  search?: string;
  cursor?: ConversationCursor;
  take: number;
};

export type ConversationReadRecord = {
  userId: string;
  conversationId: string;
  lastReadMessageId: string | null;
  lastReadAt: Date;
  lastReadMessage: {
    id: string;
    externalTimestamp: Date;
  } | null;
};

export type ConversationReadDto = {
  conversationId: string;
  lastReadMessageId: string | null;
  lastReadAt: string;
};

export type SharedConversationStateDto = {
  conversationId: string;
  unreadCount: number;
  manuallyUnread: boolean;
  manualUnreadRevision: string | null;
  awaitingResponseSince: string | null;
  revision: string;
};

export type ConversationRepository = {
  list(
    userId: string,
    query: ConversationListQuery,
  ): Promise<ConversationListRecord[]>;
  findById(
    userId: string,
    id: string,
  ): Promise<ConversationDetailRecord | null>;
  findMessage(messageId: string): Promise<MessageRecord | null>;
  findRead(
    userId: string,
    conversationId: string,
  ): Promise<ConversationReadRecord | null>;
  upsertRead(
    userId: string,
    conversationId: string,
    messageId: string,
  ): Promise<ConversationReadRecord>;
  findActiveUser(userId: string): Promise<ConversationUserRecord | null>;
  updateResponsible(
    conversationId: string,
    userId: string | null,
  ): Promise<void>;
  transaction<T>(
    operation: (repository: ConversationRepository) => Promise<T>,
  ): Promise<T>;
};
