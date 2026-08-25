import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CatalogStatusDto } from "@/modules/catalog/types";

import { useCatalogStatus } from "./use-catalog-status";

const ready: CatalogStatusDto = {
  configured: true,
  ready: true,
  catalog: { idSuffix: "…123456", name: "XP Eletrônicos", productCount: 42 },
  commerce: { catalogVisible: true, cartEnabled: true },
  freshness: "FRESH",
  lastSuccessAt: "2026-08-24T12:00:00.000Z",
  errorCode: null,
};

function response(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

describe("useCatalogStatus", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("preserves the previous successful status while one refresh is pending", async () => {
    let resolveRequest!: (value: Response) => void;
    vi.mocked(fetch).mockImplementation(() => new Promise((resolve) => { resolveRequest = resolve; }));
    const { result } = renderHook(() => useCatalogStatus(ready));

    let pending!: Promise<void>;
    act(() => { pending = result.current.refresh(); });
    expect(result.current.refreshing).toBe(true);
    expect(result.current.status).toBe(ready);
    expect(fetch).toHaveBeenCalledWith(
      "/api/settings/whatsapp/catalog/refresh",
      expect.objectContaining({ method: "POST", signal: expect.any(AbortSignal) }),
    );

    resolveRequest(response({ data: { ...ready, catalog: { ...ready.catalog!, productCount: 43 } }, error: null }));
    await act(async () => pending);
    expect(result.current.status.catalog?.productCount).toBe(43);
    expect(result.current.notice).toBe("Dados do catálogo atualizados.");
    expect(result.current.refreshing).toBe(false);
  });

  it("deduplicates refresh clicks and retains status when rate limited", async () => {
    vi.mocked(fetch).mockResolvedValue(response({
      data: null,
      error: { code: "RATE_LIMITED", message: "raw server copy" },
    }, 429));
    const { result } = renderHook(() => useCatalogStatus(ready));
    await act(async () => Promise.all([result.current.refresh(), result.current.refresh()]));

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe(ready);
    expect(result.current.notice).toBe("Aguarde um minuto antes de atualizar novamente.");
  });

  it("rejects malformed or provider-only responses without retaining their fields", async () => {
    vi.mocked(fetch).mockResolvedValue(response({
      data: { ...ready, accessToken: "private-token", catalog: { id: "123456789012345" } },
      error: null,
    }));
    const { result } = renderHook(() => useCatalogStatus(ready));
    await act(async () => result.current.refresh());

    expect(result.current.status).toBe(ready);
    expect(JSON.stringify(result.current.status)).not.toContain("private-token");
    expect(JSON.stringify(result.current.status)).not.toContain("123456789012345");
    expect(result.current.notice).toBe("Não foi possível validar a resposta do servidor.");
  });

  it("aborts an active refresh on unmount", () => {
    let signal: AbortSignal | undefined;
    vi.mocked(fetch).mockImplementation((_url, init) => {
      signal = init?.signal ?? undefined;
      return new Promise(() => undefined);
    });
    const rendered = renderHook(() => useCatalogStatus(ready));
    act(() => { void rendered.result.current.refresh(); });
    expect(signal?.aborted).toBe(false);
    rendered.unmount();
    expect(signal?.aborted).toBe(true);
  });
});
