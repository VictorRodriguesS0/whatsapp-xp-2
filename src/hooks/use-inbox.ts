"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { publicErrorMessage } from "@/lib/public-error";
import type { SessionUser } from "@/modules/auth/session";
import {
  CATALOG_COMPLETE_MESSAGE_BODY,
  CATALOG_PRODUCT_LIST_MESSAGE_BODY,
  toCatalogProductSnapshot,
  type CatalogOutboundContent,
} from "@/modules/catalog/message-content";
import type { CatalogProductDto } from "@/modules/catalog/types";
import type {
  ContactClassificationRecord,
  ContactDto as ConversationContactDto,
  ConversationDetail,
  ConversationListItem,
  ConversationListResult,
  MessageDto,
  PinnedConversationStateDto,
  SharedConversationStateDto,
} from "@/modules/conversations/types";
import type { MessageContextDto } from "@/modules/message-search/types";
import type {
  ContactDto as UpdatedContactDto,
  ContactMessagingConsentDto,
  ContactMessagingRestrictionDto,
} from "@/modules/contacts/types";
import type { ContactMessagingConsentInput } from "@/modules/contacts/schemas";
import {
  quotedReplyPreview,
  type QuotedReplyDto,
} from "@/modules/messages/reply-context";
import type { RealtimeEvent } from "@/modules/realtime/events";
import type { ResumptionResultDto } from "@/modules/resumptions/types";

import { useRealtime } from "./use-realtime";
import { useMessageReactions } from "./use-message-reactions";

export type InboxMessage = MessageDto & {
  previewUrl?: string;
  localFileName?: string;
  localMimeType?: string;
};

export type InboxConversation = Omit<ConversationDetail, "messages"> & {
  messages: InboxMessage[];
};

export type ResponsibleOption = { id: string; name: string; active: boolean };

type ApiEnvelope<T> = {
  data: T | null;
  error: { code?: string; message: string } | null;
};

type PendingReply = {
  replyToMessageId: string | null;
  replyTo: QuotedReplyDto | null;
};

type PendingText = PendingReply & {
  kind: "text";
  conversationId: string;
  clientRequestId: string;
  body: string;
};

type PendingMedia = PendingReply & {
  kind: "media";
  source: "attachment" | "recording";
  conversationId: string;
  clientRequestId: string;
  body: string;
  file: File;
  type: "IMAGE" | "AUDIO" | "VIDEO" | "DOCUMENT";
  previewUrl?: string;
};

export type CatalogSendKind = "PRODUCT" | "PRODUCT_LIST" | "CATALOG";

type PendingCatalog = {
  kind: "catalog";
  conversationId: string;
  clientRequestId: string;
  operation: CatalogSendKind;
  retailerIds: string[];
  body: string;
  content: CatalogOutboundContent;
};

type PendingSend = PendingText | PendingMedia | PendingCatalog;

type ConfirmedSend = {
  conversationId: string;
  message: InboxMessage;
};

const MAX_CONFIRMED_SENDS = 256;

type ConversationErrorState = {
  conversationId: string;
  operation: "conversation" | "responsible";
  message: string;
};

type RefreshListOptions = {
  reset?: boolean;
};

class ApiRequestError extends Error {
  constructor(
    public status: number,
    public code?: string,
  ) {
    super("API request failed");
  }
}

function errorStatus(error: unknown) {
  return error instanceof ApiRequestError ? error.status : undefined;
}

function handleUnauthorized(status: number) {
  if (status === 401 && typeof window !== "undefined") window.location.assign("/login");
}

async function readEnvelope<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || payload.data === null) {
    handleUnauthorized(response.status);
    throw new ApiRequestError(response.status, payload.error?.code);
  }
  return payload.data;
}

function mediaType(file: File): PendingMedia["type"] {
  if (file.type.startsWith("image/")) return "IMAGE";
  if (file.type.startsWith("audio/")) return "AUDIO";
  if (file.type.startsWith("video/")) return "VIDEO";
  return "DOCUMENT";
}

function updateMessage(
  conversation: InboxConversation | null,
  id: string,
  update: (message: InboxMessage) => InboxMessage,
) {
  if (!conversation) return conversation;
  return {
    ...conversation,
    messages: conversation.messages.map((message) => (message.id === id ? update(message) : message)),
  };
}

function optimisticMessage(actor: SessionUser, pending: PendingSend): InboxMessage {
  const now = new Date().toISOString();
  return {
    id: `optimistic:${pending.clientRequestId}`,
    clientRequestId: pending.clientRequestId,
    direction: "OUTBOUND",
    type: pending.kind === "text"
      ? "TEXT"
      : pending.kind === "catalog"
        ? "INTERACTIVE"
        : pending.type,
    body: pending.body || null,
    content: pending.kind === "catalog" ? pending.content : null,
    canReply: false,
    replyTo: pending.kind === "catalog" ? null : pending.replyTo,
    mediaObjectId: null,
    mediaState: null,
    sentBy: { id: actor.id, name: actor.name },
    status: "PENDING",
    failureReason: null,
    editedAt: null,
    revokedAt: null,
    reactions: [],
    externalTimestamp: now,
    createdAt: now,
    previewUrl: pending.kind === "media" ? pending.previewUrl : undefined,
    localFileName: pending.kind === "media" ? pending.file.name : undefined,
    localMimeType: pending.kind === "media" ? pending.file.type : undefined,
  };
}

function pendingReply(
  conversation: InboxConversation | null,
  replyToMessageId?: string | null,
): PendingReply | null {
  if (!replyToMessageId) {
    return { replyToMessageId: null, replyTo: null };
  }
  const target = conversation?.messages.find(
    (message) => message.id === replyToMessageId,
  );
  if (!target?.canReply) return null;
  return {
    replyToMessageId: target.id,
    replyTo: quotedReplyPreview({
      id: target.id,
      direction: target.direction,
      type: target.type,
      body: target.body,
      content: target.content,
      sentBy: target.sentBy,
    }),
  };
}

function appendConversationPage(current: ConversationListItem[], incoming: ConversationListItem[]) {
  const incomingById = new Map(incoming.map((item) => [item.id, item]));
  const merged = current.map((item) => incomingById.get(item.id) ?? item);
  const existingIds = new Set(current.map((item) => item.id));
  for (const item of incoming) {
    if (!existingIds.has(item.id)) merged.push(item);
  }
  return merged;
}

function mergeContextMessages(current: InboxMessage[], incoming: InboxMessage[]) {
  const messages = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) messages.set(message.id, { ...messages.get(message.id), ...message });
  return [...messages.values()].sort((left, right) => (
    left.externalTimestamp.localeCompare(right.externalTimestamp) || left.id.localeCompare(right.id)
  ));
}

function mergeRefreshedPage(firstPage: ConversationListItem[], current: ConversationListItem[]) {
  const refreshedIds = new Set(firstPage.map((item) => item.id));
  return [...firstPage, ...current.filter((item) => !refreshedIds.has(item.id))];
}

function conversationQueueOrder(
  left: ConversationListItem,
  right: ConversationListItem,
) {
  if (left.pinnedAt && !right.pinnedAt) return -1;
  if (!left.pinnedAt && right.pinnedAt) return 1;
  if (left.pinnedAt && right.pinnedAt) {
    const pinnedOrder = right.pinnedAt.localeCompare(left.pinnedAt);
    if (pinnedOrder !== 0) return pinnedOrder;
  }
  return right.lastMessageAt.localeCompare(left.lastMessageAt) ||
    right.id.localeCompare(left.id);
}

function applyPinnedState(
  items: ConversationListItem[],
  state: PinnedConversationStateDto,
) {
  return items
    .map((item) => item.id === state.conversationId
      ? { ...item, pinnedAt: state.pinnedAt, revision: state.revision }
      : item)
    .sort(conversationQueueOrder);
}

function withoutMergedConversations(items: ConversationListItem[], mergedConversationIds: Set<string>) {
  return items.filter((item) => !mergedConversationIds.has(item.id));
}

function pendingEntryByClientRequestId(
  pendingSends: Map<string, PendingSend>,
  clientRequestId?: string | null,
): [string, PendingSend] | null {
  if (!clientRequestId) return null;
  for (const entry of pendingSends) {
    if (entry[1].clientRequestId === clientRequestId) return entry;
  }
  return null;
}

function pendingForConversation(pendingSends: Map<string, PendingSend>, conversationId: string) {
  const unique = new Map<string, PendingSend>();
  for (const pending of pendingSends.values()) {
    if (pending.conversationId === conversationId && !unique.has(pending.clientRequestId)) {
      unique.set(pending.clientRequestId, pending);
    }
  }
  return [...unique.values()];
}

function removePendingAliases(pendingSends: Map<string, PendingSend>, clientRequestId: string) {
  for (const [rowId, pending] of pendingSends) {
    if (pending.clientRequestId === clientRequestId) pendingSends.delete(rowId);
  }
}

function retainPendingAlias(pendingSends: Map<string, PendingSend>, rowId: string, pending: PendingSend) {
  removePendingAliases(pendingSends, pending.clientRequestId);
  pendingSends.set(rowId, pending);
}

function rememberConfirmedSend(
  confirmedSends: Map<string, ConfirmedSend>,
  clientRequestId: string,
  confirmation: ConfirmedSend,
) {
  confirmedSends.delete(clientRequestId);
  confirmedSends.set(clientRequestId, confirmation);
  while (confirmedSends.size > MAX_CONFIRMED_SENDS) {
    const oldest = confirmedSends.keys().next().value;
    if (!oldest) break;
    confirmedSends.delete(oldest);
  }
}

function releasePending(pendingSends: Map<string, PendingSend>, pending: PendingSend) {
  const wasRetained = pendingEntryByClientRequestId(pendingSends, pending.clientRequestId) !== null;
  removePendingAliases(pendingSends, pending.clientRequestId);
  if (wasRetained && pending.kind === "media" && pending.previewUrl) {
    try {
      URL.revokeObjectURL?.(pending.previewUrl);
    } catch {
      // Custody is cleared before browser cleanup so this URL cannot be released twice.
    }
  }
}

function moveConversationSends(
  pendingSends: Map<string, PendingSend>,
  confirmedSends: Map<string, ConfirmedSend>,
  sourceConversationId: string,
  targetConversationId: string,
) {
  for (const pending of pendingSends.values()) {
    if (pending.conversationId === sourceConversationId) pending.conversationId = targetConversationId;
  }
  for (const confirmation of confirmedSends.values()) {
    if (confirmation.conversationId === sourceConversationId) confirmation.conversationId = targetConversationId;
  }
}

function withPendingMedia(message: MessageDto, pending: PendingMedia): InboxMessage {
  return {
    ...message,
    previewUrl: pending.previewUrl,
    localFileName: pending.file.name,
    localMimeType: pending.file.type,
  };
}

function mergeUpdatedContact(
  current: ConversationContactDto,
  updated: UpdatedContactDto,
): ConversationContactDto {
  return {
    ...current,
    ...updated,
    profileName: current.profileName ?? current.name,
  };
}

export function useInbox(initialUser: SessionUser) {
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [conversation, setConversation] = useState<InboxConversation | null>(null);
  const [users, setUsers] = useState<ResponsibleOption[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [conversationErrorState, setConversationErrorState] = useState<ConversationErrorState | null>(null);
  const [responsiblePending, setResponsiblePending] = useState(false);
  const [contactTypes, setContactTypes] = useState<ContactClassificationRecord[]>([]);
  const [contactTypesLoading, setContactTypesLoading] = useState(true);
  const [contactTypesError, setContactTypesError] = useState<string | null>(null);
  const [contactTypeSavePendingId, setContactTypeSavePendingId] = useState<string | null>(null);
  const [contactTypeSaveErrors, setContactTypeSaveErrors] = useState<Map<string, string>>(
    () => new Map(),
  );
  const [contactTags, setContactTags] = useState<ContactClassificationRecord[]>([]);
  const [contactTagsLoading, setContactTagsLoading] = useState(true);
  const [contactTagsError, setContactTagsError] = useState<string | null>(null);
  const [contactTagSavePendingId, setContactTagSavePendingId] = useState<string | null>(null);
  const [contactTagSaveErrors, setContactTagSaveErrors] = useState<Map<string, string>>(
    () => new Map(),
  );
  const [markUnreadPendingIds, setMarkUnreadPendingIds] = useState<Set<string>>(() => new Set());
  const [markUnreadErrors, setMarkUnreadErrors] = useState<Map<string, string>>(() => new Map());
  const [pinPendingIds, setPinPendingIds] = useState<Set<string>>(() => new Set());
  const [pinError, setPinError] = useState<string | null>(null);
  const [resumePendingIds, setResumePendingIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [resumeErrors, setResumeErrors] = useState<Map<string, string>>(
    () => new Map(),
  );
  const [messagingRestrictionPendingId, setMessagingRestrictionPendingId] =
    useState<string | null>(null);
  const [messagingRestrictionErrors, setMessagingRestrictionErrors] = useState<
    Map<string, string>
  >(() => new Map());
  const [messagingConsentPendingId, setMessagingConsentPendingId] =
    useState<string | null>(null);
  const [messagingConsentErrors, setMessagingConsentErrors] = useState<
    Map<string, string>
  >(() => new Map());
  const searchRef = useRef(search);
  const selectedIdRef = useRef(selectedId);
  const listRequest = useRef<{ sequence: number; controller: AbortController } | null>(null);
  const pageRequest = useRef<{ sequence: number; controller: AbortController } | null>(null);
  const conversationRequest = useRef<{ sequence: number; controller: AbortController } | null>(null);
  const contactTypesRequest = useRef<{ sequence: number; controller: AbortController } | null>(null);
  const contactTypeSaveRequests = useRef(new Map<string, Promise<boolean>>());
  const contactTagsRequest = useRef<{ sequence: number; controller: AbortController } | null>(null);
  const contactTagSaveRequests = useRef(new Map<string, Promise<boolean>>());
  const selectedContactIdRef = useRef<string | null>(null);
  const pendingSends = useRef(new Map<string, PendingSend>());
  const inFlightSends = useRef(new Map<string, Promise<InboxMessage | null>>());
  const confirmedSends = useRef(new Map<string, ConfirmedSend>());
  const mounted = useRef(true);
  const lastReadRequest = useRef<string | null>(null);
  const nextCursorRef = useRef(nextCursor);
  const hasLoadedAdditionalPages = useRef(false);
  const responsibleRequestPending = useRef(false);
  const markUnreadRequests = useRef(new Map<string, Promise<void>>());
  const pinRequests = useRef(new Map<string, Promise<void>>());
  const resumptionRequests = useRef(new Map<
    string,
    { clientRequestId: string; promise: Promise<boolean> }
  >());
  const messagingRestrictionRequests = useRef(
    new Map<string, Promise<boolean>>(),
  );
  const messagingConsentRequests = useRef(
    new Map<string, Promise<boolean>>(),
  );
  const mergedConversationIds = useRef(new Set<string>());
  const handledMerges = useRef(new Set<string>());

  searchRef.current = search;
  selectedIdRef.current = selectedId;
  nextCursorRef.current = nextCursor;
  const confirmedResult = useCallback((pending: PendingSend): InboxMessage | null => {
    const confirmation = confirmedSends.current.get(pending.clientRequestId);
    if (!confirmation || confirmation.conversationId !== pending.conversationId) return null;
    return confirmation.message;
  }, []);

  const refreshList = useCallback(async ({ reset = false }: RefreshListOptions = {}) => {
    listRequest.current?.controller.abort();
    pageRequest.current?.controller.abort();
    if (reset) {
      pageRequest.current = null;
      hasLoadedAdditionalPages.current = false;
      nextCursorRef.current = null;
      setNextCursor(null);
      setLoadingMore(false);
      setLoadMoreError(null);
    }
    const sequence = (listRequest.current?.sequence ?? 0) + 1;
    const controller = new AbortController();
    listRequest.current = { sequence, controller };
    setLoadingList(true);
    setListError(null);
    try {
      const params = new URLSearchParams();
      if (searchRef.current.trim()) params.set("search", searchRef.current.trim());
      const suffix = params.size > 0 ? `?${params.toString()}` : "";
      const response = await fetch(`/api/conversations${suffix}`, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      const result = await readEnvelope<ConversationListResult>(response);
      if (listRequest.current?.sequence === sequence) {
        const items = withoutMergedConversations(result.items, mergedConversationIds.current);
        setConversations((current) => {
          const visibleCurrent = withoutMergedConversations(current, mergedConversationIds.current);
          return hasLoadedAdditionalPages.current
            ? mergeRefreshedPage(items, visibleCurrent)
            : items;
        });
        if (!hasLoadedAdditionalPages.current) {
          nextCursorRef.current = result.nextCursor;
          setNextCursor(result.nextCursor);
        }
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      if (listRequest.current?.sequence === sequence) {
        setListError(publicErrorMessage("list", errorStatus(error)));
      }
    } finally {
      if (listRequest.current?.sequence === sequence) setLoadingList(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    const cursor = nextCursorRef.current;
    if (!cursor || loadingMore) return;
    pageRequest.current?.controller.abort();
    const sequence = (pageRequest.current?.sequence ?? 0) + 1;
    const controller = new AbortController();
    const searchAtRequest = searchRef.current.trim();
    pageRequest.current = { sequence, controller };
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const params = new URLSearchParams();
      if (searchAtRequest) params.set("search", searchAtRequest);
      params.set("cursor", cursor);
      const response = await fetch(`/api/conversations?${params.toString()}`, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      const result = await readEnvelope<ConversationListResult>(response);
      if (pageRequest.current?.sequence !== sequence || searchRef.current.trim() !== searchAtRequest) return;
      const items = withoutMergedConversations(result.items, mergedConversationIds.current);
      setConversations((current) => appendConversationPage(
        withoutMergedConversations(current, mergedConversationIds.current),
        items,
      ));
      hasLoadedAdditionalPages.current = true;
      nextCursorRef.current = result.nextCursor;
      setNextCursor(result.nextCursor);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (pageRequest.current?.sequence === sequence) {
        setLoadMoreError(publicErrorMessage("load-more", errorStatus(error)));
      }
    } finally {
      if (pageRequest.current?.sequence === sequence) setLoadingMore(false);
    }
  }, [loadingMore]);

  const changeSearch = useCallback((value: string) => {
    searchRef.current = value;
    listRequest.current?.controller.abort();
    pageRequest.current?.controller.abort();
    hasLoadedAdditionalPages.current = false;
    nextCursorRef.current = null;
    setSearch(value);
    setConversations([]);
    setNextCursor(null);
    setListError(null);
    setLoadMoreError(null);
    setLoadingMore(false);
  }, []);

  const loadUsers = useCallback(async () => {
    try {
      const response = await fetch("/api/users/assignable", { headers: { Accept: "application/json" } });
      const result = await readEnvelope<{ items: Array<{ id: string; name: string }> }>(response);
      setUsers(result.items.map((item) => ({ ...item, active: true })));
    } catch {
      // Assignment remains usable for the current employee when this secondary request fails.
      setUsers([{ id: initialUser.id, name: initialUser.name, active: true }]);
    }
  }, [initialUser.id, initialUser.name]);

  const loadContactTypes = useCallback(async () => {
    contactTypesRequest.current?.controller.abort();
    const sequence = (contactTypesRequest.current?.sequence ?? 0) + 1;
    const controller = new AbortController();
    contactTypesRequest.current = { sequence, controller };
    setContactTypesLoading(true);
    setContactTypesError(null);
    try {
      const response = await fetch("/api/contact-types", {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      const result = await readEnvelope<{ items: ContactClassificationRecord[] }>(response);
      if (contactTypesRequest.current?.sequence === sequence) {
        setContactTypes(result.items);
      }
    } catch (error) {
      if (!controller.signal.aborted && contactTypesRequest.current?.sequence === sequence) {
        setContactTypesError(publicErrorMessage("contact-types", errorStatus(error)));
      }
    } finally {
      if (contactTypesRequest.current?.sequence === sequence) {
        setContactTypesLoading(false);
      }
    }
  }, []);

  const loadContactTags = useCallback(async () => {
    contactTagsRequest.current?.controller.abort();
    const sequence = (contactTagsRequest.current?.sequence ?? 0) + 1;
    const controller = new AbortController();
    contactTagsRequest.current = { sequence, controller };
    setContactTagsLoading(true);
    setContactTagsError(null);
    try {
      const response = await fetch("/api/contact-tags", {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      const result = await readEnvelope<{ items: ContactClassificationRecord[] }>(response);
      if (contactTagsRequest.current?.sequence === sequence) {
        setContactTags(result.items);
      }
    } catch (error) {
      if (!controller.signal.aborted && contactTagsRequest.current?.sequence === sequence) {
        setContactTagsError(publicErrorMessage("contact-tags", errorStatus(error)));
      }
    } finally {
      if (contactTagsRequest.current?.sequence === sequence) {
        setContactTagsLoading(false);
      }
    }
  }, []);

  const markRead = useCallback(async (conversationId: string, messageId: string) => {
    if (messageId.startsWith("optimistic:")) return;
    const observedManualUnreadRevision = conversation?.id === conversationId
      ? conversation.manualUnreadRevision
      : null;
    const requestKey = `${conversationId}:${messageId}`;
    if (lastReadRequest.current === requestKey) return;
    lastReadRequest.current = requestKey;
    try {
      const response = await fetch(`/api/conversations/${conversationId}/read`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId, observedManualUnreadRevision }),
      });
      if (response.ok) void refreshList();
      else {
        lastReadRequest.current = null;
        handleUnauthorized(response.status);
      }
    } catch {
      lastReadRequest.current = null;
      // The list sync will preserve the unread count until the server accepts the read.
    }
  }, [conversation, refreshList]);

  const fetchConversation = useCallback(async (id: string, announceLoading: boolean) => {
    conversationRequest.current?.controller.abort();
    const sequence = (conversationRequest.current?.sequence ?? 0) + 1;
    const controller = new AbortController();
    conversationRequest.current = { sequence, controller };
    if (announceLoading) setLoadingConversation(true);
    setConversationErrorState(null);
    try {
      const response = await fetch(`/api/conversations/${id}/messages`, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      const detail = await readEnvelope<InboxConversation>(response);
      if (conversationRequest.current?.sequence !== sequence || selectedIdRef.current !== id) return;
      const confirmedRequestIds = new Set(
        detail.messages.flatMap((message) => message.clientRequestId ? [message.clientRequestId] : []),
      );
      const reconciledMessages = detail.messages.map((message): InboxMessage => {
        const entry = pendingEntryByClientRequestId(pendingSends.current, message.clientRequestId);
        if (!entry) return message;
        const pending = entry[1];
        if (pending.kind === "media" && !message.mediaObjectId) {
          retainPendingAlias(pendingSends.current, message.id, pending);
          return withPendingMedia(message, pending);
        }
        rememberConfirmedSend(confirmedSends.current, pending.clientRequestId, {
          conversationId: id,
          message,
        });
        releasePending(pendingSends.current, pending);
        return message;
      });
      const reconciledDetail = { ...detail, messages: reconciledMessages };
      selectedContactIdRef.current = reconciledDetail.contact.id;
      setConversation((current) => {
        const currentOptimistic = current?.id === id ? current.messages.filter(
          (message) => message.id.startsWith("optimistic:")
            && (!message.clientRequestId || !confirmedRequestIds.has(message.clientRequestId)),
        ) : [];
        const currentByRequestId = new Map(currentOptimistic.flatMap((message) => (
          message.clientRequestId ? [[message.clientRequestId, message] as const] : []
        )));
        const retained = pendingForConversation(pendingSends.current, id)
          .filter((pending) => !confirmedRequestIds.has(pending.clientRequestId))
          .map((pending) => currentByRequestId.get(pending.clientRequestId) ?? {
            ...optimisticMessage(initialUser, pending),
            status: inFlightSends.current.has(pending.clientRequestId) ? "PENDING" as const : "FAILED" as const,
            failureReason: inFlightSends.current.has(pending.clientRequestId)
              ? null
              : publicErrorMessage("send"),
          });
        return retained.length > 0
          ? { ...reconciledDetail, messages: [...reconciledMessages, ...retained] }
          : reconciledDetail;
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      if (conversationRequest.current?.sequence === sequence) {
        if (errorStatus(error) === 404 && selectedIdRef.current === id) {
          selectedIdRef.current = null;
          setSelectedId(null);
          setConversation(null);
          setConversationErrorState(null);
          lastReadRequest.current = null;
          return;
        }
        setConversationErrorState({
          conversationId: id,
          operation: "conversation",
          message: publicErrorMessage("conversation", errorStatus(error)),
        });
      }
    } finally {
      if (conversationRequest.current?.sequence === sequence) setLoadingConversation(false);
    }
  }, [initialUser]);

  const openConversation = useCallback(async (id: string) => {
    selectedIdRef.current = id;
    selectedContactIdRef.current = null;
    setSelectedId(id);
    setConversation((current) => current?.id === id ? current : null);
    lastReadRequest.current = null;
    await fetchConversation(id, true);
  }, [fetchConversation]);

  const loadMessageContext = useCallback(async (conversationId: string, messageId: string) => {
    try {
      const response = await fetch(
        `/api/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/context`,
        { headers: { Accept: "application/json" } },
      );
      const context = await readEnvelope<MessageContextDto>(response);
      if (selectedIdRef.current !== conversationId) return null;
      setConversation((current) => current?.id === conversationId
        ? { ...current, messages: mergeContextMessages(current.messages, context.messages) }
        : current);
      return context;
    } catch (error) {
      if (selectedIdRef.current === conversationId) {
        setConversationErrorState({
          conversationId,
          operation: "conversation",
          message: publicErrorMessage("conversation", errorStatus(error)),
        });
      }
      return null;
    }
  }, []);

  const closeConversation = useCallback(() => {
    selectedIdRef.current = null;
    selectedContactIdRef.current = null;
    setSelectedId(null);
    setConversation(null);
    setConversationErrorState(null);
    conversationRequest.current?.controller.abort();
  }, []);

  const refreshConversation = useCallback(async () => {
    const id = selectedIdRef.current;
    if (id) await fetchConversation(id, false);
  }, [fetchConversation]);

  const setContactType = useCallback((
    contactId: string,
    contactTypeId: string | null,
  ): Promise<boolean> => {
    const inFlight = contactTypeSaveRequests.current.get(contactId);
    if (inFlight) return inFlight;

    const operation = (async () => {
      setContactTypeSavePendingId(contactId);
      setContactTypeSaveErrors((current) => {
        const next = new Map(current);
        next.delete(contactId);
        return next;
      });
      try {
        const response = await fetch(`/api/contacts/${contactId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contactTypeId }),
        });
        const updated = await readEnvelope<UpdatedContactDto>(response);
        if (!mounted.current) return false;
        setConversations((current) => current.map((item) =>
          item.contact.id === contactId
            ? { ...item, contact: mergeUpdatedContact(item.contact, updated) }
            : item,
        ));
        setConversation((current) => current?.contact.id === contactId
          ? { ...current, contact: mergeUpdatedContact(current.contact, updated) }
          : current);
        void refreshList();
        return true;
      } catch (error) {
        if (!mounted.current) return false;
        const selectedConversationId = selectedContactIdRef.current === contactId
          ? selectedIdRef.current
          : null;
        if (selectedConversationId) {
          await fetchConversation(selectedConversationId, false);
        }
        void refreshList();
        setContactTypeSaveErrors((current) => {
          const next = new Map(current);
          next.set(
            contactId,
            publicErrorMessage("contact-type-save", errorStatus(error)),
          );
          return next;
        });
        return false;
      } finally {
        contactTypeSaveRequests.current.delete(contactId);
        setContactTypeSavePendingId((current) => current === contactId ? null : current);
      }
    })();

    contactTypeSaveRequests.current.set(contactId, operation);
    return operation;
  }, [fetchConversation, refreshList]);

  const replaceContactTags = useCallback((contactId: string, tagIds: string[]): Promise<boolean> => {
    const inFlight = contactTagSaveRequests.current.get(contactId);
    if (inFlight) return inFlight;

    const operation = (async () => {
      setContactTagSavePendingId(contactId);
      setContactTagSaveErrors((current) => {
        const next = new Map(current);
        next.delete(contactId);
        return next;
      });
      try {
        const response = await fetch(`/api/contacts/${contactId}/tags`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(tagIds),
        });
        const updated = await readEnvelope<UpdatedContactDto>(response);
        if (!mounted.current) return false;
        setConversations((current) => current.map((item) => item.contact.id === contactId
          ? { ...item, contact: mergeUpdatedContact(item.contact, updated) }
          : item));
        setConversation((current) => current?.contact.id === contactId
          ? { ...current, contact: mergeUpdatedContact(current.contact, updated) }
          : current);
        void refreshList();
        return true;
      } catch (error) {
        if (!mounted.current) return false;
        const selectedConversationId = selectedContactIdRef.current === contactId
          ? selectedIdRef.current
          : null;
        if (selectedConversationId) {
          await fetchConversation(selectedConversationId, false);
        }
        void refreshList();
        setContactTagSaveErrors((current) => {
          const next = new Map(current);
          next.set(contactId, publicErrorMessage("contact-tag-save", errorStatus(error)));
          return next;
        });
        return false;
      } finally {
        contactTagSaveRequests.current.delete(contactId);
        setContactTagSavePendingId((current) => current === contactId ? null : current);
      }
    })();

    contactTagSaveRequests.current.set(contactId, operation);
    return operation;
  }, [fetchConversation, refreshList]);

  const markUnread = useCallback((conversationId: string): Promise<void> => {
    const inFlight = markUnreadRequests.current.get(conversationId);
    if (inFlight) return inFlight;

    const operation = (async () => {
      setMarkUnreadPendingIds((current) => new Set(current).add(conversationId));
      setMarkUnreadErrors((current) => {
        const next = new Map(current);
        next.delete(conversationId);
        return next;
      });
      try {
        const response = await fetch(`/api/conversations/${conversationId}/unread`, {
          method: "POST",
          headers: { Accept: "application/json" },
        });
        await readEnvelope<SharedConversationStateDto>(response);
        const refreshes: Array<Promise<void>> = [refreshList()];
        if (selectedIdRef.current === conversationId) {
          refreshes.push(fetchConversation(conversationId, false));
        }
        await Promise.all(refreshes);
      } catch (error) {
        if (!mounted.current) return;
        setMarkUnreadErrors((current) => {
          const next = new Map(current);
          next.set(conversationId, publicErrorMessage("unread", errorStatus(error)));
          return next;
        });
      } finally {
        markUnreadRequests.current.delete(conversationId);
        if (mounted.current) {
          setMarkUnreadPendingIds((current) => {
            const next = new Set(current);
            next.delete(conversationId);
            return next;
          });
        }
      }
    })();
    markUnreadRequests.current.set(conversationId, operation);
    return operation;
  }, [fetchConversation, refreshList]);

  const setPinned = useCallback((conversationId: string, pinned: boolean): Promise<void> => {
    const inFlight = pinRequests.current.get(conversationId);
    if (inFlight) return inFlight;

    const optimisticTimestamp = pinned ? new Date().toISOString() : null;
    const optimisticState: PinnedConversationStateDto = {
      conversationId,
      pinnedAt: optimisticTimestamp,
      revision: optimisticTimestamp ?? new Date().toISOString(),
    };
    setPinError(null);
    setPinPendingIds((current) => new Set(current).add(conversationId));
    setConversations((current) => applyPinnedState(current, optimisticState));
    setConversation((current) => current?.id === conversationId
      ? { ...current, pinnedAt: optimisticState.pinnedAt, revision: optimisticState.revision }
      : current);

    const operation = (async () => {
      try {
        const response = await fetch(`/api/conversations/${conversationId}/pin`, {
          method: "PATCH",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({ pinned }),
        });
        const state = await readEnvelope<PinnedConversationStateDto>(response);
        if (!mounted.current) return;
        setConversations((current) => applyPinnedState(current, state));
        setConversation((current) => current?.id === conversationId
          ? { ...current, pinnedAt: state.pinnedAt, revision: state.revision }
          : current);
      } catch (error) {
        if (!mounted.current) return;
        setPinError(publicErrorMessage("pin", errorStatus(error)));
        const refreshes: Array<Promise<unknown>> = [refreshList()];
        if (selectedIdRef.current === conversationId) {
          refreshes.push(fetchConversation(conversationId, false));
        }
        await Promise.all(refreshes);
      } finally {
        pinRequests.current.delete(conversationId);
        if (mounted.current) {
          setPinPendingIds((current) => {
            const next = new Set(current);
            next.delete(conversationId);
            return next;
          });
        }
      }
    })();

    pinRequests.current.set(conversationId, operation);
    return operation;
  }, [fetchConversation, refreshList]);

  const performSend = useCallback((pending: PendingSend, rowId: string): Promise<InboxMessage | null> => {
    const existing = inFlightSends.current.get(pending.clientRequestId);
    if (existing) return existing;
    if (!mounted.current) return Promise.resolve(null);
    const operation = (async (): Promise<InboxMessage | null> => {
      setConversation((current) => updateMessage(current, rowId, (message) => ({
        ...message,
        status: "PENDING",
        failureReason: null,
      })));
      try {
        let body: BodyInit;
        let headers: HeadersInit | undefined;
        if (pending.kind === "text") {
          headers = { "Content-Type": "application/json" };
          body = JSON.stringify({
            type: "TEXT",
            clientRequestId: pending.clientRequestId,
            body: pending.body,
            ...(pending.replyToMessageId
              ? { replyToMessageId: pending.replyToMessageId }
              : {}),
          });
        } else if (pending.kind === "catalog") {
          headers = { "Content-Type": "application/json" };
          body = JSON.stringify({
            clientRequestId: pending.clientRequestId,
            kind: pending.operation,
            ...(pending.operation === "CATALOG"
              ? {}
              : { retailerIds: pending.retailerIds }),
          });
        } else {
          const form = new FormData();
          form.set("clientRequestId", pending.clientRequestId);
          if (pending.replyToMessageId) {
            form.set("replyToMessageId", pending.replyToMessageId);
          }
          if (pending.source === "attachment") {
            form.set("type", pending.type);
            if (pending.body) form.set("body", pending.body);
          }
          form.set("file", pending.file);
          body = form;
        }
        const endpoint = pending.kind === "catalog"
          ? `/api/conversations/${pending.conversationId}/catalog-messages`
          : pending.kind === "media" && pending.source === "recording"
            ? `/api/conversations/${pending.conversationId}/recordings`
            : `/api/conversations/${pending.conversationId}/messages`;
        const response = await fetch(endpoint, {
          method: "POST",
          headers,
          body,
        });
        const message = await readEnvelope<MessageDto>(response);
        if (!mounted.current) return null;
        const resolvedMessage = pending.kind === "media" && !message.mediaObjectId
          ? withPendingMedia(message, pending)
          : message;
        setConversation((current) => {
          if (!current || current.id !== pending.conversationId) return current;
          let replaced = false;
          const messages: InboxMessage[] = [];
          for (const item of current.messages) {
            const matchesRequest = item.id === rowId
              || item.id === message.id
              || item.clientRequestId === pending.clientRequestId;
            if (matchesRequest) {
              if (!replaced) messages.push(resolvedMessage);
              replaced = true;
            } else {
              messages.push(item);
            }
          }
          if (!replaced) messages.push(resolvedMessage);
          const next = {
            ...current,
            messages,
          };
          return next;
        });
        if (pending.kind === "media" && !message.mediaObjectId) {
          retainPendingAlias(pendingSends.current, message.id, pending);
        } else {
          rememberConfirmedSend(confirmedSends.current, pending.clientRequestId, {
            conversationId: pending.conversationId,
            message: resolvedMessage,
          });
          releasePending(pendingSends.current, pending);
        }
        void refreshList();
        return resolvedMessage;
      } catch (error) {
        if (!mounted.current) return null;
        const confirmed = confirmedResult(pending);
        if (confirmed) return confirmed;
        const requestError = error instanceof ApiRequestError ? error : null;
        if (
          requestError?.status === 409 &&
          requestError.code === "WHATSAPP_SERVICE_WINDOW_CLOSED"
        ) {
          releasePending(pendingSends.current, pending);
          setConversation((current) => current?.id === pending.conversationId
            ? {
                ...current,
                messages: current.messages.filter((message) => (
                  message.id !== rowId &&
                  message.clientRequestId !== pending.clientRequestId
                )),
              }
            : current);
          const refreshes: Array<Promise<void>> = [refreshList()];
          if (selectedIdRef.current === pending.conversationId) {
            refreshes.push(fetchConversation(pending.conversationId, false));
          }
          await Promise.all(refreshes);
          if (mounted.current && selectedIdRef.current === pending.conversationId) {
            setConversationErrorState({
              conversationId: pending.conversationId,
              operation: "conversation",
              message: publicErrorMessage(
                "send",
                requestError.status,
                false,
                requestError.code,
              ),
            });
          }
          return null;
        }
        const retained = pendingEntryByClientRequestId(pendingSends.current, pending.clientRequestId);
        if (!retained) return null;
        const failureRowId = retained[0];
        setConversation((current) => {
          if (!current) return current;
          return {
            ...current,
            messages: current.messages.map((message) => (
              message.id === failureRowId || message.clientRequestId === pending.clientRequestId
                ? { ...message, status: "FAILED", failureReason: publicErrorMessage("send", errorStatus(error)) }
                : message
            )),
          };
        });
        retainPendingAlias(pendingSends.current, failureRowId, pending);
        return null;
      }
    })();
    inFlightSends.current.set(pending.clientRequestId, operation);
    const clear = () => {
      if (inFlightSends.current.get(pending.clientRequestId) === operation) {
        inFlightSends.current.delete(pending.clientRequestId);
      }
    };
    void operation.then(clear, clear);
    return operation;
  }, [confirmedResult, fetchConversation, refreshList]);

  const sendText = useCallback(async (
    conversationId: string,
    body: string,
    replyToMessageId?: string | null,
  ) => {
    const trimmedBody = body.trim();
    if (!trimmedBody) return null;
    const reply = pendingReply(
      conversation?.id === conversationId ? conversation : null,
      replyToMessageId,
    );
    if (!reply) return null;
    const pending: PendingText = {
      kind: "text",
      conversationId,
      clientRequestId: crypto.randomUUID(),
      body: trimmedBody,
      ...reply,
    };
    const optimistic = optimisticMessage(initialUser, pending);
    pendingSends.current.set(optimistic.id, pending);
    setConversation((current) => current?.id === conversationId
      ? { ...current, messages: [...current.messages, optimistic] }
      : current);
    return performSend(pending, optimistic.id);
  }, [conversation, initialUser, performSend]);

  const sendCatalog = useCallback((
    conversationId: string,
    operation: CatalogSendKind,
    products: CatalogProductDto[],
  ): Promise<InboxMessage | null> => {
    if (
      (operation === "PRODUCT" && products.length !== 1) ||
      (operation === "PRODUCT_LIST" && (products.length < 1 || products.length > 30))
    ) return Promise.resolve(null);
    if (operation !== "CATALOG") {
      const retailerIds = products.map((product) => product.retailerId);
      if (
        products.some((product) => !product.availableToSend) ||
        new Set(retailerIds).size !== retailerIds.length
      ) return Promise.resolve(null);
    }

    let content: CatalogOutboundContent;
    let body: string;
    try {
      if (operation === "PRODUCT") {
        const product = toCatalogProductSnapshot(products[0]);
        body = `Produto enviado: ${product.name}`;
        content = { kind: "catalogProduct", product };
      } else if (operation === "PRODUCT_LIST") {
        const snapshots = products.map(toCatalogProductSnapshot);
        body = `Lista de produtos enviada (${snapshots.length})`;
        content = {
          kind: "catalogProductList",
          body: CATALOG_PRODUCT_LIST_MESSAGE_BODY,
          products: snapshots,
        };
      } else {
        body = "Catálogo enviado";
        content = {
          kind: "catalog",
          body: CATALOG_COMPLETE_MESSAGE_BODY,
          thumbnailRetailerId: null,
        };
      }
    } catch {
      return Promise.resolve(null);
    }

    const pending: PendingCatalog = {
      kind: "catalog",
      conversationId,
      clientRequestId: crypto.randomUUID(),
      operation,
      retailerIds: operation === "CATALOG"
        ? []
        : products.map((product) => product.retailerId),
      body,
      content,
    };
    const optimistic = optimisticMessage(initialUser, pending);
    pendingSends.current.set(optimistic.id, pending);
    setConversation((current) => current?.id === conversationId
      ? { ...current, messages: [...current.messages, optimistic] }
      : current);
    return performSend(pending, optimistic.id);
  }, [initialUser, performSend]);

  const sendMedia = useCallback(async (
    conversationId: string,
    file: File,
    caption: string,
    replyToMessageId?: string | null,
  ) => {
    const reply = pendingReply(
      conversation?.id === conversationId ? conversation : null,
      replyToMessageId,
    );
    if (!reply) return null;
    const previewUrl = typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : undefined;
    const pending: PendingMedia = {
      kind: "media",
      source: "attachment",
      conversationId,
      clientRequestId: crypto.randomUUID(),
      body: caption.trim(),
      file,
      type: mediaType(file),
      previewUrl,
      ...reply,
    };
    const optimistic = optimisticMessage(initialUser, pending);
    pendingSends.current.set(optimistic.id, pending);
    setConversation((current) => current?.id === conversationId
      ? { ...current, messages: [...current.messages, optimistic] }
      : current);
    return performSend(pending, optimistic.id);
  }, [conversation, initialUser, performSend]);

  const sendRecording = useCallback((
    conversationId: string,
    file: File,
    clientRequestId: string,
    replyToMessageId?: string | null,
  ): Promise<InboxMessage | null> => {
    const confirmed = confirmedSends.current.get(clientRequestId);
    if (confirmed?.conversationId === conversationId) {
      return Promise.resolve(confirmed.message);
    }
    const existing = pendingEntryByClientRequestId(pendingSends.current, clientRequestId);
    if (existing) {
      const [rowId, pending] = existing;
      if (
        pending.kind !== "media"
        || pending.source !== "recording"
        || pending.conversationId !== conversationId
      ) return Promise.resolve(null);
      return performSend(pending, rowId);
    }
    const reply = pendingReply(
      conversation?.id === conversationId ? conversation : null,
      replyToMessageId,
    );
    if (!reply) return Promise.resolve(null);
    const ownedFile = new File([file], file.name, {
      type: file.type,
      lastModified: file.lastModified,
    });
    const previewUrl = typeof URL.createObjectURL === "function" ? URL.createObjectURL(ownedFile) : undefined;
    const pending: PendingMedia = {
      kind: "media",
      source: "recording",
      conversationId,
      clientRequestId,
      body: "",
      file: ownedFile,
      type: "AUDIO",
      previewUrl,
      ...reply,
    };
    const optimistic = optimisticMessage(initialUser, pending);
    pendingSends.current.set(optimistic.id, pending);
    setConversation((current) => current?.id === conversationId
      ? { ...current, messages: [...current.messages, optimistic] }
      : current);
    return performSend(pending, optimistic.id);
  }, [conversation, initialUser, performSend]);

  const retryMessage = useCallback((messageId: string) => {
    const pending = pendingSends.current.get(messageId);
    if (pending) return performSend(pending, messageId);
    return (async () => {
      setConversation((current) => updateMessage(current, messageId, (message) => ({ ...message, status: "PENDING", failureReason: null })));
      try {
        const response = await fetch(`/api/messages/${messageId}/retry`, { method: "POST" });
        const payload = (await response.json()) as { data?: MessageDto; error?: string | { message?: string } };
        if (!response.ok || !payload.data) {
          handleUnauthorized(response.status);
          throw new ApiRequestError(response.status);
        }
        setConversation((current) => updateMessage(current, messageId, () => payload.data!));
        void refreshList();
        return payload.data;
      } catch (error) {
        setConversation((current) => updateMessage(current, messageId, (message) => ({
          ...message,
          status: "FAILED",
          failureReason: publicErrorMessage("retry", errorStatus(error)),
        })));
        return null;
      }
    })();
  }, [performSend, refreshList]);

  const resumeConversation = useCallback((
    conversationId: string,
  ): Promise<boolean> => {
    const existing = resumptionRequests.current.get(conversationId);
    if (existing) return existing.promise;
    const clientRequestId = crypto.randomUUID();
    setResumePendingIds((current) => new Set(current).add(conversationId));
    setResumeErrors((current) => {
      const next = new Map(current);
      next.delete(conversationId);
      return next;
    });

    const operation = (async () => {
      try {
        const response = await fetch(
          `/api/conversations/${conversationId}/resumptions`,
          {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ clientRequestId }),
          },
        );
        await readEnvelope<ResumptionResultDto>(response);
        const refreshes: Array<Promise<void>> = [refreshList()];
        if (selectedIdRef.current === conversationId) {
          refreshes.push(fetchConversation(conversationId, false));
        }
        await Promise.all(refreshes);
        return true;
      } catch (error) {
        const requestError = error instanceof ApiRequestError ? error : null;
        if (requestError?.status === 409) {
          const refreshes: Array<Promise<void>> = [refreshList()];
          if (selectedIdRef.current === conversationId) {
            refreshes.push(fetchConversation(conversationId, false));
          }
          await Promise.all(refreshes);
        }
        if (mounted.current) {
          const messages: Record<string, string> = {
            WHATSAPP_CONTACT_OPTED_OUT:
              "Este contato está marcado como não contatar.",
            WHATSAPP_RESUMPTION_ALREADY_STARTED:
              "A conversa já foi retomada. O estado foi atualizado.",
            WHATSAPP_RESUMPTION_OUTCOME_UNKNOWN:
              "O envio pode ter sido aceito. Aguarde a confirmação antes de tentar novamente.",
            WHATSAPP_TEMPLATE_NOT_READY:
              "O template de retomada não está disponível no momento.",
          };
          setResumeErrors((current) => {
            const next = new Map(current);
            next.set(
              conversationId,
              (requestError?.code && messages[requestError.code]) ||
                "Não foi possível retomar o atendimento. Tente novamente.",
            );
            return next;
          });
        }
        return false;
      } finally {
        if (
          resumptionRequests.current.get(conversationId)?.clientRequestId ===
          clientRequestId
        ) {
          resumptionRequests.current.delete(conversationId);
        }
        if (mounted.current) {
          setResumePendingIds((current) => {
            const next = new Set(current);
            next.delete(conversationId);
            return next;
          });
        }
      }
    })();
    resumptionRequests.current.set(conversationId, {
      clientRequestId,
      promise: operation,
    });
    return operation;
  }, [fetchConversation, refreshList]);

  const setMessagingRestriction = useCallback((
    contactId: string,
    restricted: boolean,
    reason: string,
  ): Promise<boolean> => {
    const existing = messagingRestrictionRequests.current.get(contactId);
    if (existing) return existing;
    const operation = (async () => {
      setMessagingRestrictionPendingId(contactId);
      setMessagingRestrictionErrors((current) => {
        const next = new Map(current);
        next.delete(contactId);
        return next;
      });
      try {
        const response = await fetch(
          `/api/contacts/${contactId}/messaging-restriction`,
          {
            method: "PUT",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ restricted, reason: reason.trim() }),
          },
        );
        const result = await readEnvelope<ContactMessagingRestrictionDto>(
          response,
        );
        if (!mounted.current) return false;
        setConversations((current) => current.map((item) =>
          item.contact.id === contactId
            ? {
                ...item,
                contact: {
                  ...item.contact,
                  messagingRestricted: result.messagingRestricted,
                },
              }
            : item,
        ));
        setConversation((current) => current?.contact.id === contactId
          ? {
              ...current,
              contact: {
                ...current.contact,
                messagingRestricted: result.messagingRestricted,
              },
            }
          : current);
        const activeConversationId = selectedIdRef.current;
        const refreshes: Array<Promise<void>> = [refreshList()];
        if (
          activeConversationId &&
          selectedContactIdRef.current === contactId
        ) {
          refreshes.push(fetchConversation(activeConversationId, false));
        }
        await Promise.all(refreshes);
        return mounted.current;
      } catch {
        if (!mounted.current) return false;
        setMessagingRestrictionErrors((current) => {
          const next = new Map(current);
          next.set(
            contactId,
            "Não foi possível salvar a preferência de contato.",
          );
          return next;
        });
        return false;
      } finally {
        messagingRestrictionRequests.current.delete(contactId);
        if (mounted.current) {
          setMessagingRestrictionPendingId((current) =>
            current === contactId ? null : current,
          );
        }
      }
    })();
    messagingRestrictionRequests.current.set(contactId, operation);
    return operation;
  }, [fetchConversation, refreshList]);

  const setMessagingConsent = useCallback((
    contactId: string,
    input: ContactMessagingConsentInput,
  ): Promise<boolean> => {
    const existing = messagingConsentRequests.current.get(contactId);
    if (existing) return existing;
    const operation = (async () => {
      setMessagingConsentPendingId(contactId);
      setMessagingConsentErrors((current) => {
        const next = new Map(current);
        next.delete(contactId);
        return next;
      });
      try {
        const payload: ContactMessagingConsentInput =
          input.action === "GRANT"
            ? {
                action: "GRANT",
                source: input.source,
                ...(input.note === undefined
                  ? {}
                  : { note: input.note.trim() }),
              }
            : { action: "REVOKE" };
        const response = await fetch(
          `/api/contacts/${contactId}/messaging-consent`,
          {
            method: "PUT",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          },
        );
        const result = await readEnvelope<ContactMessagingConsentDto>(response);
        if (!mounted.current) return false;
        setConversations((current) =>
          current.map((item) =>
            item.contact.id === contactId
              ? {
                  ...item,
                  contact: { ...item.contact, messagingConsent: result },
                }
              : item,
          ),
        );
        setConversation((current) =>
          current?.contact.id === contactId
            ? {
                ...current,
                contact: { ...current.contact, messagingConsent: result },
              }
            : current,
        );
        const activeConversationId = selectedIdRef.current;
        const refreshes: Array<Promise<void>> = [refreshList()];
        if (
          activeConversationId &&
          selectedContactIdRef.current === contactId
        ) {
          refreshes.push(fetchConversation(activeConversationId, false));
        }
        await Promise.all(refreshes);
        return mounted.current;
      } catch (error) {
        if (!mounted.current) return false;
        const requestError = error instanceof ApiRequestError ? error : null;
        setMessagingConsentErrors((current) => {
          const next = new Map(current);
          next.set(
            contactId,
            publicErrorMessage(
              "contact-consent-save",
              requestError?.status,
              false,
              requestError?.code,
            ),
          );
          return next;
        });
        return false;
      } finally {
        messagingConsentRequests.current.delete(contactId);
        if (mounted.current) {
          setMessagingConsentPendingId((current) =>
            current === contactId ? null : current,
          );
        }
      }
    })();
    messagingConsentRequests.current.set(contactId, operation);
    return operation;
  }, [fetchConversation, refreshList]);

  const getActiveConversationId = useCallback(() => selectedIdRef.current, []);
  const getReactionMessage = useCallback((messageId: string) => (
    conversation?.messages.find((message) => message.id === messageId) ?? null
  ), [conversation]);
  const replaceMessageReactions = useCallback((messageId: string, reactions: MessageDto["reactions"]) => {
    setConversation((current) => updateMessage(current, messageId, (message) => ({
      ...message,
      reactions,
    })));
  }, []);
  const messageReactions = useMessageReactions({
    actor: { id: initialUser.id, name: initialUser.name },
    getActiveConversationId,
    getMessage: getReactionMessage,
    replaceReactions: replaceMessageReactions,
  });

  const setResponsible = useCallback(async (userId: string | null): Promise<void> => {
    const id = selectedIdRef.current;
    if (!id || responsibleRequestPending.current) return;
    responsibleRequestPending.current = true;
    setResponsiblePending(true);
    try {
      const response = await fetch(`/api/conversations/${id}/responsible`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const detail = await readEnvelope<InboxConversation>(response);
      if (selectedIdRef.current === id) {
        setConversation((current) => current?.id === id
          ? { ...current, responsible: detail.responsible, updatedAt: detail.updatedAt }
          : detail);
        setConversationErrorState((current) => (
          current?.conversationId === id && current.operation === "responsible" ? null : current
        ));
      }
      void refreshList();
    } catch (error) {
      if (selectedIdRef.current === id) {
        await fetchConversation(id, false);
        if (selectedIdRef.current === id) {
          setConversationErrorState({
            conversationId: id,
            operation: "responsible",
            message: publicErrorMessage("responsible", errorStatus(error)),
          });
        }
      }
    } finally {
      responsibleRequestPending.current = false;
      setResponsiblePending(false);
    }
  }, [fetchConversation, refreshList]);

  const onRealtimeSync = useCallback(() => {
    void Promise.all([
      refreshList({ reset: true }),
      refreshConversation(),
      loadUsers(),
      loadContactTypes(),
      loadContactTags(),
    ]);
  }, [loadContactTags, loadContactTypes, loadUsers, refreshConversation, refreshList]);

  const onRealtimeEvent = useCallback((event: RealtimeEvent) => {
    if (event.type === "conversation.merged") {
      const mergeKey = `${event.sourceConversationId}:${event.targetConversationId}`;
      if (event.sourceConversationId === event.targetConversationId || handledMerges.current.has(mergeKey)) return;
      handledMerges.current.add(mergeKey);
      mergedConversationIds.current.add(event.sourceConversationId);
      moveConversationSends(
        pendingSends.current,
        confirmedSends.current,
        event.sourceConversationId,
        event.targetConversationId,
      );
      setConversations((current) => withoutMergedConversations(current, mergedConversationIds.current));
      setConversationErrorState((current) => (
        current?.conversationId === event.sourceConversationId ? null : current
      ));
      if (selectedIdRef.current !== event.sourceConversationId) {
        void refreshList();
        return;
      }
      selectedIdRef.current = event.targetConversationId;
      setSelectedId(event.targetConversationId);
      setConversation(null);
      setConversationErrorState(null);
      lastReadRequest.current = null;
      void refreshList();
      void fetchConversation(event.targetConversationId, true);
      return;
    }
    if (
      event.type === "message.created" ||
      event.type === "message.status" ||
      event.type === "message.updated" ||
      event.type === "media.updated" ||
      event.type === "reaction.updated"
    ) {
      void refreshList();
      if (event.conversationId === selectedIdRef.current) void refreshConversation();
      return;
    }
    if (event.type === "conversation.updated") {
      void refreshList({ reset: true });
      if (event.conversationId === selectedIdRef.current) void refreshConversation();
      return;
    }
    if (event.type === "responsible.updated") {
      void refreshList();
      if (event.conversationId === selectedIdRef.current) void refreshConversation();
      return;
    }
    if (event.type === "read.updated") {
      void refreshList();
      return;
    }
    if (event.type === "contact.updated") {
      void refreshList();
      if (event.contactId === selectedContactIdRef.current) void refreshConversation();
      return;
    }
    if (event.type === "contacts.synced") {
      void Promise.all([refreshList(), refreshConversation()]);
      return;
    }
    if (event.type === "user.updated") {
      void Promise.all([loadUsers(), refreshList(), refreshConversation()]);
      return;
    }
    if (event.type === "settings.updated" && event.scope === "contact-types") {
      void Promise.all([loadContactTypes(), refreshList(), refreshConversation()]);
      return;
    }
    if (event.type === "settings.updated" && event.scope === "contact-tags") {
      void Promise.all([loadContactTags(), refreshList(), refreshConversation()]);
      return;
    }
    if (event.type === "settings.updated" && event.scope === "whatsapp-policy") {
      void Promise.all([refreshList({ reset: true }), refreshConversation()]);
    }
  }, [
    fetchConversation,
    loadContactTags,
    loadContactTypes,
    loadUsers,
    refreshConversation,
    refreshList,
  ]);

  const realtime = useRealtime({ onSync: onRealtimeSync, onEvent: onRealtimeEvent });

  useEffect(() => {
    const timer = setTimeout(() => void refreshList(), search ? 250 : 0);
    return () => clearTimeout(timer);
  }, [refreshList, search]);

  useEffect(() => {
    mounted.current = true;
    void loadUsers();
    void loadContactTypes();
    void loadContactTags();
    return () => {
      mounted.current = false;
      listRequest.current?.controller.abort();
      pageRequest.current?.controller.abort();
      conversationRequest.current?.controller.abort();
      contactTypesRequest.current?.controller.abort();
      contactTagsRequest.current?.controller.abort();
      const releasedRequestIds = new Set<string>();
      const previewUrls: string[] = [];
      for (const pending of pendingSends.current.values()) {
        if (
          pending.kind === "media"
          && pending.previewUrl
          && !releasedRequestIds.has(pending.clientRequestId)
        ) {
          releasedRequestIds.add(pending.clientRequestId);
          previewUrls.push(pending.previewUrl);
        }
      }
      pendingSends.current.clear();
      inFlightSends.current.clear();
      confirmedSends.current.clear();
      markUnreadRequests.current.clear();
      pinRequests.current.clear();
      resumptionRequests.current.clear();
      messagingRestrictionRequests.current.clear();
      messagingConsentRequests.current.clear();
      contactTypeSaveRequests.current.clear();
      contactTagSaveRequests.current.clear();
      for (const previewUrl of previewUrls) {
        try {
          URL.revokeObjectURL?.(previewUrl);
        } catch {
          // The pending map no longer owns this URL, even if browser cleanup fails.
        }
      }
    };
  }, [loadContactTags, loadContactTypes, loadUsers]);

  return {
    conversations,
    conversation,
    users,
    contactTypes,
    contactTags,
    selectedId,
    search,
    nextCursor,
    loadingList,
    loadingMore,
    loadingConversation,
    contactTypesLoading,
    contactTypeSavePendingId,
    contactTagsLoading,
    contactTagSavePendingId,
    listError,
    loadMoreError,
    conversationError: conversationErrorState?.message ?? null,
    contactTypesError,
    contactTypeSaveError: selectedContactIdRef.current === null
      ? null
      : contactTypeSaveErrors.get(selectedContactIdRef.current) ?? null,
    contactTagsError,
    contactTagSaveError: selectedContactIdRef.current === null
      ? null
      : contactTagSaveErrors.get(selectedContactIdRef.current) ?? null,
    responsiblePending,
    markUnreadPending: selectedId !== null && markUnreadPendingIds.has(selectedId),
    markUnreadError: selectedId === null ? null : markUnreadErrors.get(selectedId) ?? null,
    pinPendingIds,
    pinError,
    resumePending: selectedId !== null && resumePendingIds.has(selectedId),
    resumeError:
      selectedId === null ? null : resumeErrors.get(selectedId) ?? null,
    messagingRestrictionPending:
      selectedContactIdRef.current !== null &&
      messagingRestrictionPendingId === selectedContactIdRef.current,
    messagingRestrictionError:
      selectedContactIdRef.current === null
        ? null
        : messagingRestrictionErrors.get(selectedContactIdRef.current) ?? null,
    messagingConsentPending:
      selectedContactIdRef.current !== null &&
      messagingConsentPendingId === selectedContactIdRef.current,
    messagingConsentError:
      selectedContactIdRef.current === null
        ? null
        : messagingConsentErrors.get(selectedContactIdRef.current) ?? null,
    connected: realtime.connected,
    setSearch: changeSearch,
    openConversation,
    loadMessageContext,
    closeConversation,
    refreshList,
    loadMore,
    refreshConversation,
    loadContactTypes,
    loadContactTags,
    setContactType,
    replaceContactTags,
    setMessagingRestriction,
    setMessagingConsent,
    sendText,
    sendCatalog,
    sendMedia,
    sendRecording,
    retryMessage,
    resumeConversation,
    reactToMessage: messageReactions.react,
    retryReaction: messageReactions.retry,
    reactionStateFor: messageReactions.stateFor,
    markRead,
    markUnread,
    setPinned,
    setResponsible,
  };
}
