"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { SessionUser } from "@/modules/auth/session";
import type {
  ConversationDetail,
  ConversationListItem,
  ConversationListResult,
  MessageDto,
} from "@/modules/conversations/types";
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
  conversationId: string;
  clientRequestId: string;
  body: string;
  file: File;
  type: "IMAGE" | "AUDIO" | "VIDEO" | "DOCUMENT";
  previewUrl?: string;
};

type PendingSend = PendingText | PendingMedia;

class ApiRequestError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function handleUnauthorized(status: number) {
  if (status === 401 && typeof window !== "undefined") window.location.assign("/login");
}

async function readEnvelope<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || payload.data === null) {
    handleUnauthorized(response.status);
    throw new ApiRequestError(response.status, payload.error?.message ?? "Não foi possível concluir a solicitação.");
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
    sentBy: { id: actor.id, name: actor.name },
    status: "PENDING",
    failureReason: null,
    externalTimestamp: now,
    createdAt: now,
    previewUrl: pending.kind === "media" ? pending.previewUrl : undefined,
    localFileName: pending.kind === "media" ? pending.file.name : undefined,
  };
}

export function useInbox(initialUser: SessionUser) {
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [conversation, setConversation] = useState<InboxConversation | null>(null);
  const [users, setUsers] = useState<ResponsibleOption[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [loadingList, setLoadingList] = useState(true);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [conversationError, setConversationError] = useState<string | null>(null);
  const searchRef = useRef(search);
  const selectedIdRef = useRef(selectedId);
  const listRequest = useRef<{ sequence: number; controller: AbortController } | null>(null);
  const conversationRequest = useRef<{ sequence: number; controller: AbortController } | null>(null);
  const pendingSends = useRef(new Map<string, PendingSend>());
  const lastReadRequest = useRef<string | null>(null);

  searchRef.current = search;
  selectedIdRef.current = selectedId;

  const refreshList = useCallback(async () => {
    listRequest.current?.controller.abort();
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
      if (listRequest.current?.sequence === sequence) setConversations(result.items);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (listRequest.current?.sequence === sequence) {
        setListError(error instanceof Error ? error.message : "Não foi possível carregar as conversas.");
      }
    } finally {
      if (listRequest.current?.sequence === sequence) setLoadingList(false);
    }
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

  const markRead = useCallback(async (conversationId: string, messageId: string) => {
    if (messageId.startsWith("optimistic:")) return;
    const requestKey = `${conversationId}:${messageId}`;
    if (lastReadRequest.current === requestKey) return;
    lastReadRequest.current = requestKey;
    try {
      const response = await fetch(`/api/conversations/${conversationId}/read`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId }),
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
  }, [refreshList]);

  const fetchConversation = useCallback(async (id: string, announceLoading: boolean) => {
    conversationRequest.current?.controller.abort();
    const sequence = (conversationRequest.current?.sequence ?? 0) + 1;
    const controller = new AbortController();
    conversationRequest.current = { sequence, controller };
    if (announceLoading) setLoadingConversation(true);
    setConversationError(null);
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
      for (const [rowId, pending] of pendingSends.current) {
        if (!confirmedRequestIds.has(pending.clientRequestId)) continue;
        pendingSends.current.delete(rowId);
        if (pending.kind === "media" && pending.previewUrl) URL.revokeObjectURL?.(pending.previewUrl);
      }
      setConversation((current) => {
        if (!current || current.id !== id) return detail;
        const optimistic = current.messages.filter(
          (message) => message.id.startsWith("optimistic:")
            && (!message.clientRequestId || !confirmedRequestIds.has(message.clientRequestId)),
        );
        return optimistic.length > 0 ? { ...detail, messages: [...detail.messages, ...optimistic] } : detail;
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      if (conversationRequest.current?.sequence === sequence) {
        setConversationError(error instanceof Error ? error.message : "Não foi possível carregar a conversa.");
      }
    } finally {
      if (conversationRequest.current?.sequence === sequence) setLoadingConversation(false);
    }
  }, []);

  const openConversation = useCallback(async (id: string) => {
    selectedIdRef.current = id;
    setSelectedId(id);
    setConversation((current) => current?.id === id ? current : null);
    lastReadRequest.current = null;
    await fetchConversation(id, true);
  }, [fetchConversation]);

  const closeConversation = useCallback(() => {
    selectedIdRef.current = null;
    setSelectedId(null);
    setConversation(null);
    setConversationError(null);
    conversationRequest.current?.controller.abort();
  }, []);

  const refreshConversation = useCallback(async () => {
    const id = selectedIdRef.current;
    if (id) await fetchConversation(id, false);
  }, [fetchConversation]);

  const performSend = useCallback(async (pending: PendingSend, rowId: string) => {
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
        form.set("type", pending.type);
        form.set("clientRequestId", pending.clientRequestId);
        if (pending.body) form.set("body", pending.body);
        form.set("file", pending.file);
        body = form;
      }
      const response = await fetch(`/api/conversations/${pending.conversationId}/messages`, {
        method: "POST",
        headers,
        body,
      });
      const message = await readEnvelope<MessageDto>(response);
      setConversation((current) => {
        if (!current || current.id !== pending.conversationId) return current;
        const rowExists = current.messages.some((item) => item.id === rowId);
        if (!rowExists) {
          return current.messages.some((item) => item.id === message.id)
            ? current
            : { ...current, messages: [...current.messages, message] };
        }
        const withoutServerDuplicate = current.messages.filter(
          (item) => item.id === rowId || item.id !== message.id,
        );
        return {
          ...current,
          messages: withoutServerDuplicate.map((item) => (item.id === rowId ? message : item)),
        };
      });
      pendingSends.current.delete(rowId);
      if (message.status === "FAILED" && pending.kind === "media" && !message.mediaObjectId) {
        pendingSends.current.set(message.id, pending);
      }
      if (pending.kind === "media" && pending.previewUrl && message.status !== "FAILED") {
        URL.revokeObjectURL?.(pending.previewUrl);
      }
      void refreshList();
      return message;
    } catch (error) {
      setConversation((current) => updateMessage(current, rowId, (message) => ({
        ...message,
        status: "FAILED",
        failureReason: error instanceof Error ? error.message : "Falha ao enviar",
      })));
      pendingSends.current.set(rowId, pending);
      return null;
    }
  }, [refreshList]);

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

  const retryMessage = useCallback(async (messageId: string) => {
    const pending = pendingSends.current.get(messageId);
    if (pending) return performSend(pending, messageId);
    setConversation((current) => updateMessage(current, messageId, (message) => ({ ...message, status: "PENDING", failureReason: null })));
    try {
      const response = await fetch(`/api/messages/${messageId}/retry`, { method: "POST" });
      const payload = (await response.json()) as { data?: MessageDto; error?: string | { message?: string } };
      if (!response.ok || !payload.data) {
        handleUnauthorized(response.status);
        const reason = typeof payload.error === "string" ? payload.error : payload.error?.message;
        throw new ApiRequestError(response.status, reason ?? "Falha ao reenviar");
      }
      setConversation((current) => updateMessage(current, messageId, () => payload.data!));
      void refreshList();
      return payload.data;
    } catch (error) {
      setConversation((current) => updateMessage(current, messageId, (message) => ({
        ...message,
        status: "FAILED",
        failureReason: error instanceof Error ? error.message : "Falha ao reenviar",
      })));
      return null;
    }
  }, [performSend, refreshList]);

  const setResponsible = useCallback(async (userId: string | null) => {
    const id = selectedIdRef.current;
    if (!id) return;
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
      }
      void refreshList();
    } catch (error) {
      setConversationError(error instanceof Error ? error.message : "Não foi possível alterar o responsável.");
    }
  }, [refreshList]);

  const onRealtimeSync = useCallback(() => {
    void Promise.all([refreshList(), refreshConversation(), loadUsers()]);
  }, [loadUsers, refreshConversation, refreshList]);

  const onRealtimeEvent = useCallback((event: RealtimeEvent) => {
    if (event.type === "message.created" || event.type === "message.status") {
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
    if (event.type === "user.updated") {
      void Promise.all([loadUsers(), refreshList(), refreshConversation()]);
    }
  }, [loadUsers, refreshConversation, refreshList]);

  const realtime = useRealtime({ onSync: onRealtimeSync, onEvent: onRealtimeEvent });

  useEffect(() => {
    const timer = setTimeout(() => void refreshList(), search ? 250 : 0);
    return () => clearTimeout(timer);
  }, [refreshList, search]);

  useEffect(() => {
    void loadUsers();
    return () => {
      listRequest.current?.controller.abort();
      conversationRequest.current?.controller.abort();
      for (const pending of pendingSends.current.values()) {
        if (pending.kind === "media" && pending.previewUrl) URL.revokeObjectURL?.(pending.previewUrl);
      }
    };
  }, [loadUsers]);

  return {
    conversations,
    conversation,
    users,
    selectedId,
    search,
    loadingList,
    loadingConversation,
    listError,
    conversationError,
    connected: realtime.connected,
    setSearch,
    openConversation,
    closeConversation,
    refreshList,
    refreshConversation,
    sendText,
    sendMedia,
    retryMessage,
    markRead,
    setResponsible,
  };
}
