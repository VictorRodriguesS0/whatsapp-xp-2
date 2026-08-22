import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MessageSearchResultDto } from "@/modules/message-search/types";

import { useMessageSearch } from "./use-message-search";

function item(id: string, snippet = id): MessageSearchResultDto {
  return {
    messageId: `30000000-0000-4000-8000-${id.padStart(12, "0")}`,
    conversationId: "20000000-0000-4000-8000-000000000001",
    direction: "INBOUND",
    type: "TEXT",
    externalTimestamp: "2026-08-22T12:00:00.000Z",
    snippet,
    matchedText: snippet,
    contact: { id: "40000000-0000-4000-8000-000000000001", name: "Ana", phone: "+55 61 99999-0000" },
  };
}

function response(items: MessageSearchResultDto[], nextCursor: string | null = null) {
  return Promise.resolve(new Response(JSON.stringify({ data: { items, nextCursor }, error: null }), {
    status: 200,
    headers: { "content-type": "application/json" },
  }));
}

async function flushRequests() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("useMessageSearch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not request below two characters and debounces a valid query", async () => {
    vi.mocked(fetch).mockImplementation(() => response([item("1", "pix")]));
    const { result } = renderHook(() => useMessageSearch({ scope: "global" }));

    act(() => result.current.setQuery("p"));
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(fetch).not.toHaveBeenCalled();

    act(() => result.current.setQuery("pix"));
    await act(() => vi.advanceTimersByTimeAsync(249));
    expect(fetch).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await flushRequests();
    });
    expect(result.current.items).toHaveLength(1);
    expect(fetch).toHaveBeenCalledWith("/api/message-search?query=pix&take=20", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("prevents an older response from replacing a newer query", async () => {
    let resolveOld!: (value: Response) => void;
    const old = new Promise<Response>((resolve) => { resolveOld = resolve; });
    vi.mocked(fetch)
      .mockImplementationOnce(() => old)
      .mockImplementationOnce(() => response([item("2", "novo")]));
    const { result } = renderHook(() => useMessageSearch({ scope: "global", debounceMs: 1 }));

    act(() => result.current.setQuery("antigo"));
    await act(() => vi.advanceTimersByTimeAsync(1));
    act(() => result.current.setQuery("novo"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await flushRequests();
    });
    expect(result.current.items[0]?.snippet).toBe("novo");

    await act(async () => resolveOld(await response([item("1", "antigo")])));
    expect(result.current.items[0]?.snippet).toBe("novo");
  });

  it("appends pages without duplicates and navigates loaded matches", async () => {
    vi.mocked(fetch)
      .mockImplementationOnce(() => response([item("1")], "next"))
      .mockImplementationOnce(() => response([item("1"), item("2")], null));
    const { result } = renderHook(() => useMessageSearch({ scope: "conversation", conversationId: "20000000-0000-4000-8000-000000000001", debounceMs: 1 }));

    act(() => result.current.setQuery("produto"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await flushRequests();
    });
    expect(result.current.nextCursor).toBe("next");
    await act(() => result.current.loadMore());
    expect(result.current.items.map((entry) => entry.messageId)).toEqual([item("1").messageId, item("2").messageId]);

    act(() => result.current.next());
    expect(result.current.activeIndex).toBe(1);
    act(() => result.current.next());
    expect(result.current.activeIndex).toBe(0);
    act(() => result.current.previous());
    expect(result.current.activeIndex).toBe(1);
  });
});
