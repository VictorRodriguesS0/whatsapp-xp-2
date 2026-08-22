import type { MessageDirection, MessageType } from "@/generated/prisma/enums";
import type { MessageDto } from "@/modules/conversations/types";

export type MessageSearchCursor = {
  externalTimestamp: string;
  id: string;
};

export type MessageSearchInput = {
  query: string;
  take?: number;
  cursor?: string;
};

export type ConversationMessageSearchInput = MessageSearchInput;

export type MessageSearchQuery = {
  query: string;
  take: number;
  cursor: MessageSearchCursor | null;
  conversationId: string | null;
};

export type MessageSearchRecord = {
  messageId: string;
  conversationId: string;
  direction: MessageDirection;
  type: MessageType;
  externalTimestamp: Date;
  searchText: string;
  contactId: string;
  contactName: string;
  contactPreferredName: string | null;
  contactPhone: string | null;
};

export type MessageSearchResultDto = {
  messageId: string;
  conversationId: string;
  direction: MessageDirection;
  type: MessageType;
  externalTimestamp: string;
  snippet: string;
  matchedText: string;
  contact: {
    id: string;
    name: string;
    phone: string;
  };
};

export type MessageSearchPage = {
  items: MessageSearchResultDto[];
  nextCursor: string | null;
};

export type ConversationMessageSearchPage = MessageSearchPage;

export type MessageContextDto = {
  conversationId: string;
  targetMessageId: string;
  messages: MessageDto[];
};

export type MessageSearchRepository = {
  findActiveUser(actorId: string): Promise<{ id: string } | null>;
  search(query: MessageSearchQuery): Promise<MessageSearchRecord[]>;
  loadContext(
    conversationId: string,
    messageId: string,
  ): Promise<MessageContextDto | null>;
};
