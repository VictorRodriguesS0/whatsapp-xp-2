import { UserRole } from "@/generated/prisma/enums";
import { HttpError } from "@/lib/http";
import type { SessionUser } from "@/modules/auth/session";
import { describe, expect, it, vi } from "vitest";

import type { CatalogProduct } from "./schemas";
import { CatalogServiceError } from "./service";
import { preflightCatalogMessage, sendCatalogMessage } from "./send-service";

const actor: SessionUser = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Victor",
  email: "victor@example.test",
  role: UserRole.ADMIN,
};
const conversationId = "10000000-0000-4000-8000-000000000001";
const clientRequestId = "50000000-0000-4000-8000-000000000001";

function product(retailerId: string, name: string): CatalogProduct {
  return {
    retailerId,
    name,
    description: `${name} com descrição`,
    priceText: "BRL 100.00",
    availability: "IN_STOCK",
    availableToSend: true,
    imageUrl: "https://images.example.test/product.webp",
  };
}

function dependencies(products: CatalogProduct[] = []) {
  return {
    catalog: { validateForSend: vi.fn().mockResolvedValue(products) },
    assertFreeFormSendAllowed: vi.fn().mockResolvedValue(undefined),
  };
}

describe("catalog send preflight", () => {
  it("authorizes, revalidates and builds one safe product snapshot", async () => {
    const deps = dependencies([product("XP-1", "Controle")]);

    await expect(preflightCatalogMessage(actor, conversationId, {
      clientRequestId,
      kind: "PRODUCT",
      retailerIds: ["XP-1"],
    }, deps)).resolves.toEqual({
      clientRequestId,
      body: "Produto enviado: Controle",
      content: {
        kind: "catalogProduct",
        product: {
          retailerId: "XP-1",
          name: "Controle",
          description: "Controle com descrição",
          priceText: "BRL 100.00",
          availability: "IN_STOCK",
        },
      },
    });
    expect(deps.assertFreeFormSendAllowed).toHaveBeenCalledWith(
      conversationId,
      expect.any(Date),
    );
    expect(deps.catalog.validateForSend).toHaveBeenCalledWith(actor, ["XP-1"]);
  });

  it("preserves submitted order in a bounded product-list snapshot", async () => {
    const deps = dependencies([
      product("XP-2", "Headset"),
      product("XP-1", "Controle"),
    ]);

    const result = await preflightCatalogMessage(actor, conversationId, {
      clientRequestId,
      kind: "PRODUCT_LIST",
      retailerIds: ["XP-2", "XP-1"],
    }, deps);

    expect(result).toMatchObject({
      body: "Lista de produtos enviada (2)",
      content: {
        kind: "catalogProductList",
        body: "Confira estas opções do catálogo da XP Eletrônicos.",
        products: [
          { retailerId: "XP-2", name: "Headset" },
          { retailerId: "XP-1", name: "Controle" },
        ],
      },
    });
  });

  it("revalidates readiness for the complete catalog without accepting ids", async () => {
    const deps = dependencies();

    await expect(preflightCatalogMessage(actor, conversationId, {
      clientRequestId,
      kind: "CATALOG",
    }, deps)).resolves.toEqual({
      clientRequestId,
      body: "Catálogo enviado",
      content: {
        kind: "catalog",
        body: "Confira o catálogo da XP Eletrônicos.",
        thumbnailRetailerId: null,
      },
    });
    expect(deps.catalog.validateForSend).toHaveBeenCalledWith(actor, []);
  });

  it("does not query the catalog when the conversation policy blocks the send", async () => {
    const deps = dependencies([product("XP-1", "Controle")]);
    deps.assertFreeFormSendAllowed.mockRejectedValue(
      new HttpError(409, "Janela encerrada", "WHATSAPP_SERVICE_WINDOW_CLOSED"),
    );

    await expect(preflightCatalogMessage(actor, conversationId, {
      clientRequestId,
      kind: "PRODUCT",
      retailerIds: ["XP-1"],
    }, deps)).rejects.toMatchObject({ code: "WHATSAPP_SERVICE_WINDOW_CLOSED" });
    expect(deps.catalog.validateForSend).not.toHaveBeenCalled();
  });

  it.each([
    ["CATALOG_PRODUCT_UNAVAILABLE", 409, "CATALOG_PRODUCT_UNAVAILABLE"],
    ["CATALOG_NOT_READY", 409, "CATALOG_NOT_READY"],
    ["META_TIMEOUT", 503, "CATALOG_TEMPORARILY_UNAVAILABLE"],
    ["META_RATE_LIMITED", 503, "CATALOG_TEMPORARILY_UNAVAILABLE"],
  ] as const)("maps %s to a safe public failure", async (code, status, publicCode) => {
    const deps = dependencies();
    deps.catalog.validateForSend.mockRejectedValue(new CatalogServiceError(code));

    await expect(preflightCatalogMessage(actor, conversationId, {
      clientRequestId,
      kind: "CATALOG",
    }, deps)).rejects.toMatchObject({ status, code: publicCode });
  });

  it("rejects forged input before authorization or catalog access", async () => {
    const deps = dependencies();

    await expect(preflightCatalogMessage(actor, conversationId, {
      clientRequestId,
      kind: "PRODUCT",
      retailerIds: ["XP-1"],
      catalogId: "forged",
    }, deps)).rejects.toBeDefined();
    expect(deps.assertFreeFormSendAllowed).not.toHaveBeenCalled();
    expect(deps.catalog.validateForSend).not.toHaveBeenCalled();
  });

  it("delivers only the server-prepared snapshot to the message state machine", async () => {
    const deps = dependencies([product("XP-1", "Controle")]);
    const sendPreparedCatalogMessage = vi.fn().mockResolvedValue({ id: "message-1" });

    await expect(sendCatalogMessage(actor, conversationId, {
      clientRequestId,
      kind: "PRODUCT",
      retailerIds: ["XP-1"],
    }, { ...deps, sendPreparedCatalogMessage })).resolves.toEqual({ id: "message-1" });

    expect(sendPreparedCatalogMessage).toHaveBeenCalledWith(
      actor,
      conversationId,
      expect.objectContaining({
        clientRequestId,
        content: {
          kind: "catalogProduct",
          product: expect.objectContaining({ retailerId: "XP-1", name: "Controle" }),
        },
      }),
    );
  });
});
