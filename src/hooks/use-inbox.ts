"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { publicErrorMessage } from "@/lib/public-error";
import type { SessionUser } from "@/modules/auth/session";
import type {
  ContactClassificationRecord,
  ContactDto as ConversationContactDto,
  ConversationDetail,
  ConversationListItem,
  ConversationListResult,
  MessageDto,
  SharedConversationStateDto,
} from "@/modules/conversations/types";
import type { ContactDto as UpdatedContactDto } from "@/modules/contacts/types";
import type { RealtimeEvent } from "@/modules/realtime/events";

import { useRealtime } from "./use-realtime";

export type InboxMessage = MessageDto & {
  previewUrl?: string;
  localFileName?: string;
};

export type InboxConversation = Omit<ConversationDetail, "messages"> & {
  messages: InboxMessage[];
};

export type ResponsibleOption = { id: string; name: string; active: boolean };

type ApiEnvelope<T> = {
  data: T | null;
  error: { code?: string; message: string } | null;
};

type PendingText = {
  kind: "text";
  conversationId: string;
  clientRequestId: string;
  body: string;
};

type PendingMedia = {
  kind: "media";
  source: "attachment" | "recording";
  conversationId: string;
  clientRequestId: string;
  body: string;
  file: File;
  type: "IMAGE" | "AUDIO" | "VIDEO" | "DOCUMENT";
  previewUrl?: string;
};

type PendingSend = PendingText | PendingMedia;

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
  constructor(public status: number) {
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
    throw new ApiRequestError(response.status);
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
    type: pending.kind === "text" ? "TEXT" : pending.type,
    body: pending.body || null,
    mediaObjectId: null,
    mediaState: null,
    sentBy: { id: actor.id, name: actor.name },
    status: "PENDING",
    failureReason: null,
    externalTimestamp: now,
    createdAt: now,
    previewUrl: pending.kind === "media" ? pending.previewUrl : undefined,
    localFileName: pending.kind === "media" ? pending.file.name : undefined,
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

function mergeRefreshedPage(firstPage: ConversationListItem[], current: ConversationListItem[]) {
  const refreshedIds = new Set(firstPage.map((item) => item.id));
  return [...firstPage, ...current.filter((item) => !refreshedIds.has(item.id))];
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
      setConversations([]);
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
          });
        } else {
          const form = new FormData();
          form.set("clientRequestId", pending.clientRequestId);
          if (pending.source === "attachment") {
            form.set("type", pending.type);
            if (pending.body) form.set("body", pending.body);
          }
          form.set("file", pending.file);
          body = form;
        }
        const endpoint = pending.kind === "media" && pending.source === "recording"
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
  }, [confirmedResult, refreshList]);

  const sendText = useCallback(async (conversationId: string, body: string) => {
    const pending: PendingText = {
      kind: "text",
      conversationId,
      clientRequestId: crypto.randomUUID(),
      body: body.trim(),
    };
    if (!pending.body) return null;
    const optimistic = optimisticMessage(initialUser, pending);
    pendingSends.current.set(optimistic.id, pending);
    setConversation((current) => current?.id === conversationId
      ? { ...current, messages: [...current.messages, optimistic] }
      : current);
    return performSend(pending, optimistic.id);
  }, [initialUser, performSend]);

  const sendMedia = useCallback(async (conversationId: string, file: File, caption: string) => {
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
    };
    const optimistic = optimisticMessage(initialUser, pending);
    pendingSends.current.set(optimistic.id, pending);
    setConversation((current) => current?.id === conversationId
      ? { ...current, messages: [...current.messages, optimistic] }
      : current);
    return performSend(pending, optimistic.id);
  }, [initialUser, performSend]);

  const sendRecording = useCallback((
    conversationId: string,
    file: File,
    clientRequestId: string,
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
    };
    const optimistic = optimisticMessage(initialUser, pending);
    pendingSends.current.set(optimistic.id, pending);
    setConversation((current) => current?.id === conversationId
      ? { ...current, messages: [...current.messages, optimistic] }
      : current);
    return performSend(pending, optimistic.id);
  }, [initialUser, performSend]);

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
      event.type === "media.updated"
    ) {
      void refreshList();
      if (event.conversationId === selectedIdRef.current) void refreshConversation();
      return;
    }
    if (event.type === "responsible.updated" || event.type === "conversation.updated") {
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
    connected: realtime.connected,
    setSearch: changeSearch,
    openConversation,
    closeConversation,
    refreshList,
    loadMore,
    refreshConversation,
    loadContactTypes,
    loadContactTags,
    setContactType,
    replaceContactTags,
    sendText,
    sendMedia,
    sendRecording,
    retryMessage,
    markRead,
    markUnread,
    setResponsible,
  };
}
