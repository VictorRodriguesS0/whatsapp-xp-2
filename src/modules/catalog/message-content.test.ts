import { describe, expect, it } from "vitest";

import { toCatalogProductSnapshot } from "./message-content";

describe("catalog message content", () => {
  it("creates a bounded snapshot without retaining a remote image URL", () => {
    const snapshot = toCatalogProductSnapshot({
      retailerId: "XP-CONTROLE-01",
      name: "Controle sem fio",
      description: `Descrição ${"muito longa ".repeat(80)}`,
      priceText: "BRL R$ 449,99",
      availability: "IN_STOCK",
      availableToSend: true,
      imageUrl: "https://cdn.example/private-product.jpg",
    });

    expect(snapshot).toMatchObject({
      retailerId: "XP-CONTROLE-01",
      name: "Controle sem fio",
      priceText: "BRL R$ 449,99",
      availability: "IN_STOCK",
    });
    expect(snapshot.description?.length).toBeLessThanOrEqual(512);
    expect(snapshot).not.toHaveProperty("imageUrl");
    expect(snapshot).not.toHaveProperty("availableToSend");
  });
});
