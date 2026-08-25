// @vitest-environment node

import { UserRole } from "@/generated/prisma/enums";
import { HttpError } from "@/lib/http";
import { describe, expect, it, vi } from "vitest";

import { createWhatsAppCatalogRefreshRouteHandlers } from "./route";

const admin = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Victor",
  email: "victor@example.test",
  role: UserRole.ADMIN,
};
const status = {
  configured: true,
  ready: false,
  catalog: { idSuffix: "…123456", name: "XP Eletrônicos", productCount: 42 },
  commerce: { catalogVisible: false, cartEnabled: true },
  freshness: "FRESH" as const,
  lastSuccessAt: "2026-08-24T12:00:00.000Z",
  errorCode: null,
};
const request = (origin = "http://localhost") => new Request(
  "http://localhost/api/settings/whatsapp/catalog/refresh",
  { method: "POST", headers: { origin } },
);

describe("WhatsApp catalog refresh route", () => {
  it("requires same origin and admin, then returns sanitized refreshed status", async () => {
    const refreshStatus = vi.fn().mockResolvedValue(status);
    const { POST } = createWhatsAppCatalogRefreshRouteHandlers({
      assertSameOrigin: () => undefined,
      requireAdmin: async () => admin,
      refreshStatus,
    });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(refreshStatus).toHaveBeenCalledWith(admin);
    await expect(response.json()).resolves.toEqual({ data: status, error: null });
  });

  it("rejects cross-origin requests before authentication", async () => {
    const requireAdmin = vi.fn();
    const refreshStatus = vi.fn();
    const { POST } = createWhatsAppCatalogRefreshRouteHandlers({
      assertSameOrigin: () => { throw new HttpError(403, "Origem inválida"); },
      requireAdmin,
      refreshStatus,
    });
    expect((await POST(request("https://evil.example"))).status).toBe(403);
    expect(requireAdmin).not.toHaveBeenCalled();
    expect(refreshStatus).not.toHaveBeenCalled();
  });

  it.each([
    [401, "missing session"],
    [401, "inactive user"],
    [403, "attendant"],
  ])("returns %i for %s before refreshing", async (httpStatus, _case) => {
    const refreshStatus = vi.fn();
    const { POST } = createWhatsAppCatalogRefreshRouteHandlers({
      assertSameOrigin: () => undefined,
      requireAdmin: async () => { throw new HttpError(httpStatus, "Bloqueado"); },
      refreshStatus,
    });
    expect((await POST(request())).status).toBe(httpStatus);
    expect(refreshStatus).not.toHaveBeenCalled();
  });

  it("returns a stable 429 when manual refresh is rate limited", async () => {
    const { POST } = createWhatsAppCatalogRefreshRouteHandlers({
      assertSameOrigin: () => undefined,
      requireAdmin: async () => admin,
      refreshStatus: async () => { throw new HttpError(429, "Aguarde antes de atualizar novamente", "CATALOG_REFRESH_RATE_LIMITED"); },
    });
    const response = await POST(request());
    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      data: null,
      error: { code: "RATE_LIMITED", message: "Aguarde antes de atualizar novamente" },
    });
  });

  it("exposes no handler for unsafe GET refreshes", async () => {
    const route = await import("./route");
    expect(route).not.toHaveProperty("GET");
  });
});
