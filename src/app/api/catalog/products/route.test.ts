// @vitest-environment node

import { UserRole } from "@/generated/prisma/enums";
import { HttpError } from "@/lib/http";
import { CatalogServiceError } from "@/modules/catalog/service";
import { describe, expect, it, vi } from "vitest";

import { createCatalogProductsRouteHandlers } from "./route";

const actor = {
  id: "10000000-0000-4000-8000-000000000001",
  name: "Ana",
  email: "ana@example.test",
  role: UserRole.ATTENDANT,
};
const page = {
  products: [{
    retailerId: "SKU-1",
    name: "Controle",
    description: null,
    priceText: "BRL 199.90",
    availability: "IN_STOCK" as const,
    availableToSend: true,
    imagePath: "/api/catalog/products/SKU-1/image",
  }],
  nextCursor: null,
  freshness: "FRESH" as const,
  fetchedAt: "2026-08-24T12:00:00.000Z",
};

describe("catalog products route", () => {
  it.each([UserRole.ATTENDANT, UserRole.ADMIN])("allows an active %s to search validated products", async (role) => {
    const searchProducts = vi.fn().mockResolvedValue(page);
    const { GET } = createCatalogProductsRouteHandlers({
      requireUser: async () => ({ ...actor, role }),
      searchProducts,
    });

    const response = await GET(new Request("http://localhost/api/catalog/products?query=%20controle%20&limit=12"));
    expect(response.status).toBe(200);
    expect(searchProducts).toHaveBeenCalledWith({ ...actor, role }, {
      query: "controle",
      cursor: null,
      limit: 12,
    });
    await expect(response.json()).resolves.toEqual({ data: page, error: null });
  });

  it.each([
    ["missing session", "Não autenticado"],
    ["inactive user", "Sessão inválida"],
  ])("rejects %s before searching", async (_case, message) => {
    const searchProducts = vi.fn();
    const { GET } = createCatalogProductsRouteHandlers({
      requireUser: async () => { throw new HttpError(401, message); },
      searchProducts,
    });
    const response = await GET(new Request("http://localhost/api/catalog/products"));
    expect(response.status).toBe(401);
    expect(searchProducts).not.toHaveBeenCalled();
  });

  it.each([
    "?query=x&query=y",
    `?query=${"a".repeat(121)}`,
    `?cursor=${"a".repeat(1025)}`,
    "?limit=0",
    "?limit=51",
    "?limit=1.5",
    "?unknown=1",
  ])("rejects an invalid or duplicate query without calling the service: %s", async (query) => {
    const searchProducts = vi.fn();
    const { GET } = createCatalogProductsRouteHandlers({ requireUser: async () => actor, searchProducts });
    const response = await GET(new Request(`http://localhost/api/catalog/products${query}`));
    expect(response.status).toBe(400);
    expect(searchProducts).not.toHaveBeenCalled();
  });

  it("redacts tokens, raw URLs, catalog IDs and unexpected Graph errors", async () => {
    const privateText = "Bearer token-private https://graph.facebook.com/catalog/123456789012345";
    const { GET } = createCatalogProductsRouteHandlers({
      requireUser: async () => actor,
      searchProducts: async () => { throw new Error(privateText); },
    });
    const response = await GET(new Request("http://localhost/api/catalog/products"));
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).toBe('{"data":null,"error":{"code":"INTERNAL_ERROR","message":"Erro interno"}}');
    expect(text).not.toContain("token-private");
    expect(text).not.toContain("graph.facebook.com");
    expect(text).not.toContain("123456789012345");
  });

  it("maps a sanitized service failure without exposing its raw cause", async () => {
    const { GET } = createCatalogProductsRouteHandlers({
      requireUser: async () => actor,
      searchProducts: async () => { throw new CatalogServiceError("CATALOG_PERMISSION_REQUIRED"); },
    });
    const response = await GET(new Request("http://localhost/api/catalog/products"));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      data: null,
      error: { code: "CATALOG_UNAVAILABLE", message: "Catálogo temporariamente indisponível" },
    });
  });
});
