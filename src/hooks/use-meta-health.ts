"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { MetaHealthSummaryDto, MetaSyncResult } from "@/modules/meta-health/types";
import type { RealtimeEvent } from "@/modules/realtime/events";

import { useRealtime } from "./use-realtime";

const POLL_INTERVAL_MS = 60_000;

function isSummary(value: unknown): value is MetaHealthSummaryDto {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<MetaHealthSummaryDto>;
  return (
    ["NORMAL", "ATTENTION", "CRITICAL", "STALE"].includes(candidate.label ?? "") &&
    typeof candidate.unacknowledgedCount === "number" &&
    typeof candidate.stale === "boolean" &&
    Boolean(candidate.phone) &&
    Boolean(candidate.account)
  );
}

export function useMetaHealth(initialSummary: MetaHealthSummaryDto) {
  const [summary, setSummary] = useState(initialSummary);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<MetaSyncResult | null>(null);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const syncInFlight = useRef<Promise<MetaSyncResult | null> | null>(null);
  const staleSyncAttempted = useRef(false);
  const refreshRef = useRef<(allowStaleSync?: boolean) => Promise<void>>(async () => undefined);

  const synchronize = useCallback((manual = false): Promise<MetaSyncResult | null> => {
    if (syncInFlight.current) return syncInFlight.current;
    if (!manual && staleSyncAttempted.current) return Promise.resolve(null);
    if (!manual) staleSyncAttempted.current = true;
    const operation = (async () => {
      if (mounted.current) setSyncing(true);
      try {
        const response = await fetch("/api/meta-health/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        const payload = (await response.json()) as { result?: MetaSyncResult };
        const result = response.ok && payload.result ? payload.result : null;
        if (mounted.current) setSyncResult(result);
        await refreshRef.current(false);
        return result;
      } catch {
        return null;
      } finally {
        syncInFlight.current = null;
        if (mounted.current) setSyncing(false);
      }
    })();
    syncInFlight.current = operation;
    return operation;
  }, []);

  const refresh = useCallback(async (allowStaleSync = true): Promise<void> => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const response = await fetch("/api/meta-health/summary", {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      const payload = (await response.json()) as { summary?: unknown };
      if (!response.ok || !isSummary(payload.summary) || controller.signal.aborted) return;
      setSummary(payload.summary);
      if (!payload.summary.stale) staleSyncAttempted.current = false;
      if (payload.summary.stale && allowStaleSync) void synchronize(false);
    } catch {
      // Keep the last authoritative state; a transport error must never look normal.
    }
  }, [synchronize]);
  refreshRef.current = refresh;

  const onRealtimeSync = useCallback(() => void refresh(), [refresh]);
  const onRealtimeEvent = useCallback((event: RealtimeEvent) => {
    if (event.type === "meta-health.updated") void refresh();
  }, [refresh]);
  useRealtime({ onSync: onRealtimeSync, onEvent: onRealtimeEvent });

  useEffect(() => {
    mounted.current = true;
    if (initialSummary.stale) void synchronize(false);
    const timer = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
      request.current?.abort();
    };
  }, [initialSummary.stale, refresh, synchronize]);

  return {
    summary,
    refresh,
    sync: () => synchronize(true),
    syncing,
    syncResult,
  };
}
