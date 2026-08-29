import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  catalogProductPageSchema,
  catalogSearchInputSchema,
  normalizeCatalogProduct,
  toCatalogProductDto,
} from "./schemas";

describe("catalogSearchInputSchema", () => {
  it("normalizes a bounded query and applies the default page size", () => {
    expect(
      catalogSearchInputSchema.parse({ query: "  Controle   PS5  " }),
    ).toEqual({ query: "Controle PS5", cursor: null, limit: 20 });
  });

  it("accepts a bounded opaque cursor and maximum page size", () => {
    expect(
      catalogSearchInputSchema.parse({ query: "", cursor: "cursor_123", limit: 50 }),
    ).toEqual({ query: "", cursor: "cursor_123", limit: 50 });
  });

  it.each([
    { query: "x".repeat(121) },
    { query: "produto\u0000oculto" },
    { cursor: "x".repeat(1025) },
    { cursor: "cursor\u0007" },
    { limit: 0 },
    { limit: 51 },
  ])("rejects unsafe or unbounded search input %#", (input) => {
    expect(() => catalogSearchInputSchema.parse(input)).toThrow();
  });
});

describe("normalizeCatalogProduct", () => {
  it("normalizes a sendable visible product without exposing its image URL", () => {
    const product = normalizeCatalogProduct({
      retailer_id: " XP-CONTROLE-01 ",
      name: "  Controle   sem fio  ",
      description: " Compatível com PS5 ",
      price: "R$ 399,90",
      availability: "in stock",
      visibility: "published",
      image_url: "https://images.example.test/product.webp",
    });

    expect(product).toMatchObject({
      retailerId: "XP-CONTROLE-01",
      name: "Controle sem fio",
      description: "Compatível com PS5",
      priceText: "R$ 399,90",
      availability: "IN_STOCK",
      availableToSend: true,
      imageUrl: "https://images.example.test/product.webp",
    });
    expect(toCatalogProductDto(product!)).toEqual({
      retailerId: "XP-CONTROLE-01",
      name: "Controle sem fio",
      description: "Compatível com PS5",
      priceText: "R$ 399,90",
      availability: "IN_STOCK",
      availableToSend: true,
      imagePath: "/api/catalog/products/XP-CONTROLE-01/image",
    });
    expect(JSON.stringify(toCatalogProductDto(product!))).not.toContain(
      "images.example.test",
    );
  });

  it.each([
    "out of stock",
    "discontinued",
    "unexpected availability",
  ])("marks %s as unavailable to send", (availability) => {
    expect(
      normalizeCatalogProduct({
        retailer_id: "XP-01",
        name: "Produto",
        availability,
        visibility: "published",
      }),
    ).toMatchObject({ availableToSend: false });
  });

  it("marks hidden products unavailable even when stock is present", () => {
    expect(
      normalizeCatalogProduct({
        retailer_id: "XP-01",
        name: "Produto",
        availability: "in stock",
        visibility: "hidden",
      }),
    ).toMatchObject({ availableToSend: false });
  });

  it("accepts the longer descriptions returned by the live Meta catalog", () => {
    const description = "A".repeat(2_278);

    expect(
      normalizeCatalogProduct({
        retailer_id: "XP-DESCRICAO-LONGA",
        name: "Produto com descrição detalhada",
        description,
        availability: "in stock",
        visibility: "published",
      }),
    ).toMatchObject({ description });
  });

  it.each([
    {},
    { retailer_id: "", name: "Produto" },
    { retailer_id: "XP 01", name: "Produto" },
    { retailer_id: "XP-01", name: "" },
    { retailer_id: "XP-01", name: "x".repeat(513) },
    { retailer_id: "XP-01", name: "Produto\u0000oculto" },
  ])("rejects a malformed Graph product %#", (value) => {
    expect(normalizeCatalogProduct(value)).toBeNull();
  });
});

describe("catalogProductPageSchema", () => {
  const product = {
    retailerId: "XP-01",
    name: "Produto",
    description: null,
    priceText: null,
    availability: "IN_STOCK" as const,
    availableToSend: true,
    imageUrl: null,
  };

  it("accepts at most fifty normalized products", () => {
    expect(
      catalogProductPageSchema.parse({
        products: Array.from({ length: 50 }, (_, index) => ({
          ...product,
          retailerId: `XP-${index}`,
        })),
        nextCursor: "next-cursor",
      }).products,
    ).toHaveLength(50);
  });

  it("rejects an oversized page", () => {
    expect(() =>
      catalogProductPageSchema.parse({
        products: Array.from({ length: 51 }, (_, index) => ({
          ...product,
          retailerId: `XP-${index}`,
        })),
        nextCursor: null,
      }),
    ).toThrow();
  });
});
