import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RealtimeEvent } from "@/modules/realtime/events";
import type { MetaHealthSummaryDto } from "@/modules/meta-health/types";

import { useMetaHealth } from "./use-meta-health";

let realtimeCallbacks: { onSync: () => void; onEvent: (event: RealtimeEvent) => void } | null = null;
vi.mock("./use-realtime", () => ({
  useRealtime: (callbacks: typeof realtimeCallbacks) => {
    realtimeCallbacks = callbacks;
    return { connected: true };
  },
}));

const normal: MetaHealthSummaryDto = {
  label: "NORMAL",
  unacknowledgedCount: 0,
  stale: false,
  phone: { displayPhoneNumber: "+55 61 9514-9019", verifiedName: "XP Eletrônicos", qualityRating: "GREEN" },
  account: { reviewStatus: "APPROVED", event: null, messagingLimit: null },
  lastSuccessfulSyncAt: "2026-08-23T12:00:00.000Z",
  lastSyncAttemptAt: "2026-08-23T12:00:00.000Z",
  lastSyncErrorCode: null,
};

function jsonResponse(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: async () => body } as Response);
}

describe("useMetaHealth", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    realtimeCallbacks = null;
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("renders the server summary immediately and polls after sixty seconds", async () => {
    vi.mocked(fetch).mockImplementation(() => jsonResponse({ summary: { ...normal, unacknowledgedCount: 1 } }));
    const { result } = renderHook(() => useMetaHealth(normal));
    expect(result.current.summary).toBe(normal);
    expect(fetch).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(fetch).toHaveBeenCalledWith("/api/meta-health/summary", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(result.current.summary.unacknowledgedCount).toBe(1);
  });

  it("starts one stale synchronization and refetches its summary", async () => {
    const stale = { ...normal, label: "STALE" as const, stale: true };
    vi.mocked(fetch).mockImplementation((input) =>
      String(input).endsWith("/sync")
        ? jsonResponse({ result: { status: "SYNCED", success: true } })
        : jsonResponse({ summary: normal }),
    );
    renderHook(() => useMetaHealth(stale));
    await act(async () => {
      for (let turn = 0; turn < 6; turn += 1) await Promise.resolve();
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith("/sync"))).toHaveLength(1);
  });

  it("refreshes on realtime invalidation and keeps the last summary on failure", async () => {
    vi.mocked(fetch).mockImplementation(() => Promise.reject(new Error("offline")));
    const { result } = renderHook(() => useMetaHealth({ ...normal, label: "CRITICAL" }));
    await act(async () => realtimeCallbacks!.onEvent({ type: "meta-health.updated" }));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.current.summary.label).toBe("CRITICAL");
  });

  it("aborts the active summary request on unmount", async () => {
    let signal: AbortSignal | undefined;
    vi.mocked(fetch).mockImplementation((_url, init) => {
      signal = init?.signal ?? undefined;
      return new Promise(() => undefined);
    });
    const rendered = renderHook(() => useMetaHealth(normal));
    act(() => realtimeCallbacks!.onSync());
    expect(signal?.aborted).toBe(false);
    rendered.unmount();
    expect(signal?.aborted).toBe(true);
  });
});
