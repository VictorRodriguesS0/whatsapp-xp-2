import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCatalogProducts } from "./use-catalog-products";

const item = {
  retailerId: "CTRL-01",
  name: "Controle sem fio",
  description: "Controle para videogame",
  priceText: "BRL 199.90",
  availability: "IN_STOCK" as const,
  availableToSend: true,
  imagePath: "/api/catalog/products/CTRL-01/image",
};

function envelope(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ data, error: status >= 400 ? { code: "CATALOG_UNAVAILABLE" } : null }),
  } as Response;
}

describe("useCatalogProducts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("loads only while open and resets the query when the conversation changes", async () => {
    vi.mocked(fetch).mockResolvedValue(envelope({
      products: [item], nextCursor: null, freshness: "FRESH", fetchedAt: "2026-08-24T12:00:00.000Z",
    }));
    const rendered = renderHook(
      ({ conversationId, open }) => useCatalogProducts({ conversationId, open }),
      { initialProps: { conversationId: "one", open: false } },
    );
    expect(fetch).not.toHaveBeenCalled();

    rendered.rerender({ conversationId: "one", open: true });
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(rendered.result.current.items).toEqual([item]);
    act(() => rendered.result.current.setQuery("controle"));
    expect(rendered.result.current.query).toBe("controle");

    rendered.rerender({ conversationId: "two", open: true });
    expect(rendered.result.current.query).toBe("");
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(fetch).toHaveBeenLastCalledWith(
      "/api/catalog/products?limit=20&query=",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("debounces search and aborts an obsolete request", async () => {
    const signals: AbortSignal[] = [];
    vi.mocked(fetch).mockImplementation((_url, init) => {
      signals.push(init?.signal as AbortSignal);
      return new Promise(() => undefined);
    });
    const { result } = renderHook(() => useCatalogProducts({ conversationId: "one", open: true }));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(fetch).toHaveBeenCalledTimes(1);

    act(() => result.current.setQuery("con"));
    expect(signals[0]?.aborted).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(249));
    expect(fetch).toHaveBeenCalledTimes(1);
    act(() => result.current.setQuery("controle"));
    await act(async () => vi.advanceTimersByTimeAsync(250));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(vi.mocked(fetch).mock.calls[1]?.[0])).toContain("query=controle");
  });

  it("appends a page, deduplicates products and retries a failed load", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(envelope({ products: [item], nextCursor: "next", freshness: "FRESH", fetchedAt: "2026-08-24T12:00:00.000Z" }))
      .mockResolvedValueOnce(envelope({ products: [item, { ...item, retailerId: "CABO-01", name: "Cabo HDMI", imagePath: null }], nextCursor: null, freshness: "STALE", fetchedAt: "2026-08-24T12:00:00.000Z" }))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(envelope({ products: [item], nextCursor: null, freshness: "FRESH", fetchedAt: "2026-08-24T12:00:00.000Z" }));
    const { result } = renderHook(() => useCatalogProducts({ conversationId: "one", open: true }));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    await act(async () => result.current.loadMore());
    expect(result.current.items.map(({ retailerId }) => retailerId)).toEqual(["CTRL-01", "CABO-01"]);
    expect(result.current.freshness).toBe("STALE");

    act(() => result.current.setQuery("novo"));
    await act(async () => vi.advanceTimersByTimeAsync(250));
    expect(result.current.error).toBe("Não foi possível carregar os produtos.");
    await act(async () => result.current.retry());
    expect(result.current.error).toBeNull();
    expect(result.current.items).toEqual([item]);
  });

  it("rejects provider-only or malformed product data", async () => {
    vi.mocked(fetch).mockResolvedValue(envelope({
      products: [{ ...item, imageUrl: "https://private.example/item", accessToken: "secret" }],
      nextCursor: null,
      freshness: "FRESH",
      fetchedAt: "2026-08-24T12:00:00.000Z",
    }));
    const { result } = renderHook(() => useCatalogProducts({ conversationId: "one", open: true }));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(result.current.items).toEqual([]);
    expect(result.current.error).toBe("Resposta de catálogo inválida.");
    expect(JSON.stringify(result.current)).not.toContain("secret");
    expect(JSON.stringify(result.current)).not.toContain("private.example");
  });
});
