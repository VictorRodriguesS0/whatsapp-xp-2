import { Prisma } from "@/generated/prisma/client";
import { describe, expect, it } from "vitest";
import { parseMessageContent } from "./content";
import { messageContentForPrisma } from "./content.server";

describe("parseMessageContent", () => {
  it("accepts a bounded location", () => {
    expect(
      parseMessageContent({
        kind: "location",
        latitude: -15.793889,
        longitude: -47.882778,
        name: "XP Eletrônicos",
        address: "Brasília - DF",
      }),
    ).toEqual({
      kind: "location",
      latitude: -15.793889,
      longitude: -47.882778,
      name: "XP Eletrônicos",
      address: "Brasília - DF",
    });
  });

  it.each([
    { kind: "location", latitude: 91, longitude: 0, name: null, address: null },
    { kind: "location", latitude: 0, longitude: -181, name: null, address: null },
    { kind: "contacts", contacts: [] },
    { kind: "interactive", interaction: "button", id: "", title: "Escolher" },
    { kind: "unknown", rawType: "token\\u0000leak" },
  ])("rejects invalid persisted content %#", (value) => {
    expect(parseMessageContent(value)).toBeNull();
  });

  it("maps absent content to the Prisma database null sentinel", () => {
    expect(messageContentForPrisma(null)).toBe(Prisma.DbNull);
  });

  it("keeps old order rows valid and accepts the three outbound catalog snapshots", () => {
    expect(parseMessageContent({
      kind: "order",
      catalogId: "legacy-catalog-id",
      productCount: 2,
    })).toEqual({
      kind: "order",
      catalogId: "legacy-catalog-id",
      productCount: 2,
    });

    const product = {
      retailerId: "XP-CONTROLE-01",
      name: "Controle sem fio",
      description: "Compatível com console e PC",
      priceText: "BRL R$ 449,99",
      availability: "IN_STOCK",
    } as const;

    expect(parseMessageContent({ kind: "catalogProduct", product })).toEqual({
      kind: "catalogProduct",
      product,
    });
    expect(parseMessageContent({
      kind: "catalogProductList",
      body: "Produtos selecionados",
      products: [product, { ...product, retailerId: "XP-CONTROLE-02" }],
    })).toEqual({
      kind: "catalogProductList",
      body: "Produtos selecionados",
      products: [product, { ...product, retailerId: "XP-CONTROLE-02" }],
    });
    expect(parseMessageContent({
      kind: "catalog",
      body: "Confira nosso catálogo",
      thumbnailRetailerId: "XP-CONTROLE-01",
    })).toEqual({
      kind: "catalog",
      body: "Confira nosso catálogo",
      thumbnailRetailerId: "XP-CONTROLE-01",
    });
  });

  it.each([
    {
      kind: "catalogProduct",
      catalogId: "browser-controlled",
      product: {
        retailerId: "XP-1",
        name: "Produto",
        description: null,
        priceText: null,
        availability: "IN_STOCK",
      },
    },
    {
      kind: "catalogProductList",
      body: "Lista",
      products: Array.from({ length: 31 }, (_, index) => ({
        retailerId: `XP-${index}`,
        name: `Produto ${index}`,
        description: null,
        priceText: null,
        availability: "IN_STOCK",
      })),
    },
    {
      kind: "catalogProductList",
      body: "Lista",
      products: [
        { retailerId: "XP-1", name: "Um", description: null, priceText: null, availability: "IN_STOCK" },
        { retailerId: "XP-1", name: "Duplicado", description: null, priceText: null, availability: "IN_STOCK" },
      ],
    },
    {
      kind: "catalog",
      body: "Catálogo",
      thumbnailRetailerId: "unsafe id with spaces",
    },
  ])("rejects malformed or browser-forged catalog content %#", (value) => {
    expect(parseMessageContent(value)).toBeNull();
  });
});
