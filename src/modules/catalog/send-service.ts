import "server-only";

import { HttpError } from "@/lib/http";
import { requireUser } from "@/modules/auth/guards";
import type { SessionUser } from "@/modules/auth/session";
import { assertFreeFormSendAllowed } from "@/modules/messaging-policy/service";
import { messageUuidSchema } from "@/modules/messages/schemas";

import {
  toCatalogProductSnapshot,
  type CatalogOutboundContent,
} from "./message-content";
import {
  catalogSendInputSchema,
  type CatalogSendInput,
} from "./send-schemas";
import {
  CatalogServiceError,
  type CatalogService,
} from "./service";

export const CATALOG_PRODUCT_MESSAGE_BODY =
  "Confira este produto do catálogo da XP Eletrônicos.";
export const CATALOG_PRODUCT_LIST_MESSAGE_BODY =
  "Confira estas opções do catálogo da XP Eletrônicos.";
export const CATALOG_COMPLETE_MESSAGE_BODY =
  "Confira o catálogo da XP Eletrônicos.";
export const CATALOG_MESSAGE_FOOTER = "XP Eletrônicos";

export type PreparedCatalogMessage = {
  clientRequestId: string;
  body: string;
  content: CatalogOutboundContent;
};

export type CatalogSendPreflightDependencies = {
  catalog: Pick<CatalogService, "validateForSend">;
  assertFreeFormSendAllowed?: (
    conversationId: string,
    now: Date,
  ) => Promise<void>;
  now?: () => Date;
};

function publicCatalogError(error: CatalogServiceError): HttpError {
  if (error.code === "CATALOG_PRODUCT_UNAVAILABLE") {
    return new HttpError(
      409,
      "Um produto selecionado não está mais disponível no catálogo.",
      "CATALOG_PRODUCT_UNAVAILABLE",
    );
  }
  if (
    error.code === "CATALOG_NOT_READY" ||
    error.code === "CATALOG_NOT_CONFIGURED" ||
    error.code === "CATALOG_NOT_FOUND" ||
    error.code === "CATALOG_PERMISSION_REQUIRED"
  ) {
    return new HttpError(
      409,
      "O catálogo não está disponível para envio agora.",
      "CATALOG_NOT_READY",
    );
  }
  return new HttpError(
    503,
    "Não foi possível confirmar o catálogo agora. Tente novamente.",
    "CATALOG_TEMPORARILY_UNAVAILABLE",
  );
}

export async function preflightCatalogMessage(
  actor: SessionUser,
  conversationId: string,
  rawInput: unknown,
  dependencies: CatalogSendPreflightDependencies,
): Promise<PreparedCatalogMessage> {
  const input: CatalogSendInput = catalogSendInputSchema.parse(rawInput);
  messageUuidSchema.parse(actor.id);
  const parsedConversationId = messageUuidSchema.parse(conversationId);
  await requireUser(async () => actor);
  await (dependencies.assertFreeFormSendAllowed ?? assertFreeFormSendAllowed)(
    parsedConversationId,
    (dependencies.now ?? (() => new Date()))(),
  );

  const retailerIds = input.kind === "CATALOG" ? [] : input.retailerIds;
  let products;
  try {
    products = await dependencies.catalog.validateForSend(actor, retailerIds);
  } catch (error) {
    if (error instanceof CatalogServiceError) throw publicCatalogError(error);
    throw error;
  }

  if (input.kind === "PRODUCT") {
    const product = products[0];
    if (!product) throw publicCatalogError(new CatalogServiceError("CATALOG_PRODUCT_UNAVAILABLE"));
    const snapshot = toCatalogProductSnapshot(product);
    return {
      clientRequestId: input.clientRequestId,
      body: `Produto enviado: ${snapshot.name}`,
      content: { kind: "catalogProduct", product: snapshot },
    };
  }
  if (input.kind === "PRODUCT_LIST") {
    const snapshots = products.map(toCatalogProductSnapshot);
    if (snapshots.length !== input.retailerIds.length) {
      throw publicCatalogError(new CatalogServiceError("CATALOG_PRODUCT_UNAVAILABLE"));
    }
    return {
      clientRequestId: input.clientRequestId,
      body: `Lista de produtos enviada (${snapshots.length})`,
      content: {
        kind: "catalogProductList",
        body: CATALOG_PRODUCT_LIST_MESSAGE_BODY,
        products: snapshots,
      },
    };
  }
  return {
    clientRequestId: input.clientRequestId,
    body: "Catálogo enviado",
    content: {
      kind: "catalog",
      body: CATALOG_COMPLETE_MESSAGE_BODY,
      thumbnailRetailerId: null,
    },
  };
}
