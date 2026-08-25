// @vitest-environment node

import { UserRole } from "@/generated/prisma/enums";
import { HttpError } from "@/lib/http";
import { describe, expect, it, vi } from "vitest";

import { createWhatsAppCatalogStatusRouteHandlers } from "./route";

const admin = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Victor",
  email: "victor@example.test",
  role: UserRole.ADMIN,
};
const status = {
  configured: true,
  ready: true,
  catalog: { idSuffix: "…123456", name: "XP Eletrônicos", productCount: 42 },
  commerce: { catalogVisible: true, cartEnabled: true },
  freshness: "FRESH" as const,
  lastSuccessAt: "2026-08-24T12:00:00.000Z",
  errorCode: null,
};

describe("WhatsApp catalog status route", () => {
  it("returns only sanitized catalog status to an admin", async () => {
    const getStatus = vi.fn().mockResolvedValue(status);
    const { GET } = createWhatsAppCatalogStatusRouteHandlers({ requireAdmin: async () => admin, getStatus });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(getStatus).toHaveBeenCalledWith(admin);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ data: status, error: null });
    expect(text).not.toContain("Bearer");
    expect(text).not.toContain("graph.facebook.com");
    expect(text).not.toContain("123456789012345");
  });

  it.each([
    [401, "missing session"],
    [401, "inactive user"],
    [403, "attendant"],
  ])("returns %i for %s before reading status", async (httpStatus, _case) => {
    const getStatus = vi.fn();
    const { GET } = createWhatsAppCatalogStatusRouteHandlers({
      requireAdmin: async () => { throw new HttpError(httpStatus, httpStatus === 403 ? "Acesso negado" : "Não autenticado"); },
      getStatus,
    });
    expect((await GET()).status).toBe(httpStatus);
    expect(getStatus).not.toHaveBeenCalled();
  });

  it("redacts unexpected service details", async () => {
    const { GET } = createWhatsAppCatalogStatusRouteHandlers({
      requireAdmin: async () => admin,
      getStatus: async () => { throw new Error("Bearer secret Graph raw payload"); },
    });
    const response = await GET();
    expect(response.status).toBe(500);
    expect(await response.text()).toBe('{"data":null,"error":{"code":"INTERNAL_ERROR","message":"Erro interno"}}');
  });
});
