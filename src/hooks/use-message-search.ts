"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  MessageSearchPage,
  MessageSearchResultDto,
} from "@/modules/message-search/types";

type SearchScope = "global" | "conversation";

type UseMessageSearchOptions = {
  scope: SearchScope;
  conversationId?: string;
  debounceMs?: number;
};

type ApiEnvelope = {
  data: MessageSearchPage | null;
  error: { message?: string } | null;
};

function uniqueResults(
  current: MessageSearchResultDto[],
  incoming: MessageSearchResultDto[],
): MessageSearchResultDto[] {
  const byId = new Map(current.map((item) => [item.messageId, item]));
  for (const item of incoming) byId.set(item.messageId, item);
  return [...byId.values()];
}

export function useMessageSearch({
  scope,
  conversationId,
  debounceMs = 250,
}: UseMessageSearchOptions) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<MessageSearchResultDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const revision = useRef(0);
  const controller = useRef<AbortController | null>(null);

  const execute = useCallback(async (
    term: string,
    cursor: string | null,
    append: boolean,
    requestRevision: number,
    requestController: AbortController,
  ) => {
    const endpoint = scope === "global"
      ? "/api/message-search"
      : conversationId
        ? `/api/conversations/${encodeURIComponent(conversationId)}/message-search`
        : null;
    if (!endpoint) return;

    const params = new URLSearchParams();
    params.set("query", term);
    params.set("take", "20");
    if (cursor) params.set("cursor", cursor);

    try {
      const response = await fetch(`${endpoint}?${params.toString()}`, {
        signal: requestController.signal,
      });
      const envelope = await response.json() as ApiEnvelope;
      if (!response.ok || !envelope.data) throw new Error(envelope.error?.message || "Não foi possível pesquisar mensagens");
      if (requestRevision !== revision.current) return;
      setItems((current) => append ? uniqueResults(current, envelope.data!.items) : envelope.data!.items);
      setNextCursor(envelope.data.nextCursor);
      setActiveIndex((current) => append ? current : 0);
      setError(null);
    } catch (caught) {
      if (requestController.signal.aborted || requestRevision !== revision.current) return;
      setError(caught instanceof Error ? caught.message : "Não foi possível pesquisar mensagens");
    } finally {
      if (requestRevision === revision.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [conversationId, scope]);

  useEffect(() => {
    const term = query.trim();
    const requestRevision = ++revision.current;
    controller.current?.abort();

    if (term.length < 2) {
      setItems([]);
      setNextCursor(null);
      setError(null);
      setLoading(false);
      setLoadingMore(false);
      setActiveIndex(0);
      return;
    }

    setLoading(true);
    setLoadingMore(false);
    const requestController = new AbortController();
    controller.current = requestController;
    const timer = window.setTimeout(() => {
      void execute(term, null, false, requestRevision, requestController);
    }, debounceMs);

    return () => {
      window.clearTimeout(timer);
      requestController.abort();
    };
  }, [debounceMs, execute, query]);

  useEffect(() => {
    if (scope === "conversation") setQuery("");
  }, [conversationId, scope]);

  const loadMore = useCallback(async () => {
    const term = query.trim();
    if (term.length < 2 || !nextCursor || loading || loadingMore) return;
    const requestRevision = ++revision.current;
    controller.current?.abort();
    const requestController = new AbortController();
    controller.current = requestController;
    setLoadingMore(true);
    await execute(term, nextCursor, true, requestRevision, requestController);
  }, [execute, loading, loadingMore, nextCursor, query]);

  const retry = useCallback(() => {
    const term = query.trim();
    if (term.length < 2) return;
    const requestRevision = ++revision.current;
    controller.current?.abort();
    const requestController = new AbortController();
    controller.current = requestController;
    setLoading(true);
    setError(null);
    void execute(term, null, false, requestRevision, requestController);
  }, [execute, query]);

  const reset = useCallback(() => {
    ++revision.current;
    controller.current?.abort();
    setQuery("");
    setItems([]);
    setNextCursor(null);
    setError(null);
    setLoading(false);
    setLoadingMore(false);
    setActiveIndex(0);
  }, []);

  const next = useCallback(() => {
    setActiveIndex((current) => items.length ? (current + 1) % items.length : 0);
  }, [items.length]);

  const previous = useCallback(() => {
    setActiveIndex((current) => items.length ? (current - 1 + items.length) % items.length : 0);
  }, [items.length]);

  return {
    query,
    setQuery,
    items,
    loading,
    loadingMore,
    error,
    nextCursor,
    retry,
    loadMore,
    activeIndex,
    setActiveIndex,
    next,
    previous,
    reset,
  };
}
