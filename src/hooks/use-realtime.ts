"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

import type { RealtimeEvent } from "@/modules/realtime/events";

type Subscriber = {
  onSync: () => void;
  onEvent: (event: RealtimeEvent) => void;
};

type UseRealtimeOptions = Subscriber;

const subscribers = new Set<Subscriber>();
const statusSubscribers = new Set<() => void>();
let source: EventSource | null = null;
let updateListener: EventListener | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
let connected = false;

function emitStatus(next: boolean) {
  if (connected === next) return;
  connected = next;
  for (const notify of statusSubscribers) notify();
}

function isRealtimeEvent(value: unknown): value is RealtimeEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as {
    type?: unknown;
    conversationId?: unknown;
    sourceConversationId?: unknown;
    targetConversationId?: unknown;
    userId?: unknown;
    messageId?: unknown;
    mediaId?: unknown;
    contactId?: unknown;
    scope?: unknown;
    revision?: unknown;
  };
  if (typeof event.type !== "string") return false;
  if (event.type === "user.updated") return typeof event.userId === "string";
  if (event.type === "meta-health.updated") return true;
  if (event.type === "conversation.merged") {
    return (
      typeof event.sourceConversationId === "string" &&
      typeof event.targetConversationId === "string"
    );
  }
  if (event.type === "media.updated") {
    return (
      typeof event.conversationId === "string" &&
      typeof event.messageId === "string" &&
      typeof event.mediaId === "string"
    );
  }
  if (event.type === "contact.updated") {
    return typeof event.contactId === "string";
  }
  if (event.type === "contacts.synced") {
    return (
      typeof event.revision === "string" &&
      Object.keys(event).every((key) => key === "type" || key === "revision")
    );
  }
  if (event.type === "settings.updated") {
    return event.scope === "contact-types" || event.scope === "contact-tags";
  }
  return ["conversation.updated", "message.created", "message.status", "read.updated", "responsible.updated"].includes(event.type)
    && typeof event.conversationId === "string";
}

function clearReconnectTimer() {
  if (reconnectTimer !== null) clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function disconnect() {
  clearReconnectTimer();
  if (source && updateListener) source.removeEventListener("update", updateListener);
  source?.close();
  source = null;
  updateListener = null;
  reconnectAttempt = 0;
  emitStatus(false);
}

function connect() {
  if (source || reconnectTimer !== null || subscribers.size === 0 || typeof EventSource === "undefined") return;

  const nextSource = new EventSource("/api/realtime");
  source = nextSource;

  nextSource.onopen = () => {
    if (source !== nextSource) return;
    reconnectAttempt = 0;
    emitStatus(true);
    for (const subscriber of subscribers) subscriber.onSync();
  };

  const handleUpdate = (message: MessageEvent<string>) => {
    try {
      const event: unknown = JSON.parse(message.data);
      if (!isRealtimeEvent(event)) return;
      for (const subscriber of subscribers) subscriber.onEvent(event);
    } catch {
      // A malformed event is ignored; the next open always performs a full sync.
    }
  };
  updateListener = handleUpdate as EventListener;
  nextSource.addEventListener("update", updateListener);

  nextSource.onerror = () => {
    if (source !== nextSource) return;
    nextSource.removeEventListener("update", handleUpdate as EventListener);
    updateListener = null;
    nextSource.close();
    source = null;
    emitStatus(false);
    const delay = Math.min(1_000 * 2 ** reconnectAttempt, 15_000);
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };
}

function subscribeStatus(notify: () => void) {
  statusSubscribers.add(notify);
  return () => statusSubscribers.delete(notify);
}

export function useRealtime({ onSync, onEvent }: UseRealtimeOptions) {
  const callbacksRef = useRef({ onSync, onEvent });
  callbacksRef.current = { onSync, onEvent };

  useEffect(() => {
    const subscriber: Subscriber = {
      onSync: () => callbacksRef.current.onSync(),
      onEvent: (event) => callbacksRef.current.onEvent(event),
    };
    subscribers.add(subscriber);
    connect();
    return () => {
      subscribers.delete(subscriber);
      if (subscribers.size === 0) disconnect();
    };
  }, []);

  return {
    connected: useSyncExternalStore(subscribeStatus, () => connected, () => false),
  };
}
