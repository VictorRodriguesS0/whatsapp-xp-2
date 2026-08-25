// @vitest-environment node

import { UserRole } from "@/generated/prisma/enums";
import { HttpError } from "@/lib/http";
import { CatalogImageProxyError } from "@/modules/catalog/image-proxy";
import { describe, expect, it, vi } from "vitest";

import { createCatalogProductImageRouteHandlers } from "./route";

const actor = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Victor",
  email: "victor@example.test",
  role: UserRole.ADMIN,
};
const context = { params: Promise.resolve({ retailerId: "SKU-1" }) };

describe("authenticated catalog product image route", () => {
  it("returns a verified image with private bounded caching", async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff]);
    const getCatalogProductImage = vi.fn().mockResolvedValue({ bytes, contentType: "image/jpeg" });
    const { GET } = createCatalogProductImageRouteHandlers({
      requireUser: async () => actor,
      getCatalogProductImage,
    });

    const response = await GET(
      new Request("https://whatsapp.xpeletronicos.com/api/catalog/products/SKU-1/image"),
      context,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("content-length")).toBe("3");
    expect(response.headers.get("cache-control")).toBe("private, max-age=300, stale-while-revalidate=60");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(getCatalogProductImage).toHaveBeenCalledWith("SKU-1");
  });

  it("authenticates before resolving a product image", async () => {
    const getCatalogProductImage = vi.fn();
    const { GET } = createCatalogProductImageRouteHandlers({
      requireUser: async () => { throw new HttpError(401, "Não autenticado"); },
      getCatalogProductImage,
    });

    const response = await GET(new Request("https://whatsapp.xpeletronicos.com/api/catalog/products/SKU-1/image"), context);
    expect(response.status).toBe(401);
    expect(getCatalogProductImage).not.toHaveBeenCalled();
  });

  it("returns a stable 404 before resolving a malformed retailer ID", async () => {
    const getCatalogProductImage = vi.fn();
    const { GET } = createCatalogProductImageRouteHandlers({
      requireUser: async () => actor,
      getCatalogProductImage,
    });

    const response = await GET(
      new Request("https://whatsapp.xpeletronicos.com/api/catalog/products/bad/image"),
      { params: Promise.resolve({ retailerId: "../segredo" }) },
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Imagem de produto não encontrada" });
    expect(getCatalogProductImage).not.toHaveBeenCalled();
  });

  it("falls back only to the same-origin placeholder without leaking upstream details", async () => {
    const { GET } = createCatalogProductImageRouteHandlers({
      requireUser: async () => actor,
      getCatalogProductImage: async () => { throw new CatalogImageProxyError("UNSAFE_ORIGIN"); },
    });
    const response = await GET(
      new Request("https://whatsapp.xpeletronicos.com/api/catalog/products/SKU-1/image"),
      context,
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://whatsapp.xpeletronicos.com/catalog-product-placeholder.svg");
    expect(response.headers.get("cache-control")).toBe("private, max-age=300, stale-while-revalidate=60");
    expect(response.headers.get("location")).not.toContain("cdn");
  });
});
