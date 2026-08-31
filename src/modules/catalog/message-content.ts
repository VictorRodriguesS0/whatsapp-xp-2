import { z } from "zod";

import {
  catalogAvailabilityValues,
  type CatalogAvailability,
} from "./types";

export const CATALOG_PRODUCT_MESSAGE_BODY =
  "Confira este produto do catálogo da XP Eletrônicos.";
export const CATALOG_PRODUCT_LIST_MESSAGE_BODY =
  "Confira estas opções do catálogo da XP Eletrônicos.";
export const CATALOG_COMPLETE_MESSAGE_BODY =
  "Confira o catálogo da XP Eletrônicos.";
export const CATALOG_MESSAGE_FOOTER = "XP Eletrônicos";

const retailerIdSchema = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/u);

export const catalogProductSnapshotSchema = z
  .object({
    retailerId: retailerIdSchema,
    name: z.string().min(1).max(512),
    description: z.string().min(1).max(512).nullable(),
    priceText: z.string().min(1).max(128).nullable(),
    availability: z.enum(catalogAvailabilityValues),
  })
  .strict();

const catalogProductListSchema = z
  .array(catalogProductSnapshotSchema)
  .min(1)
  .max(30)
  .superRefine((products, context) => {
    const seen = new Set<string>();
    products.forEach((product, index) => {
      if (seen.has(product.retailerId)) {
        context.addIssue({
          code: "custom",
          message: "Produtos duplicados não são permitidos",
          path: [index, "retailerId"],
        });
      }
      seen.add(product.retailerId);
    });
  });

export const catalogContentSchema = z
  .object({
    kind: z.literal("catalog"),
    body: z.string().min(1).max(1_024),
    thumbnailRetailerId: retailerIdSchema.nullable(),
  })
  .strict();

export const catalogProductContentSchema = z
  .object({
    kind: z.literal("catalogProduct"),
    product: catalogProductSnapshotSchema,
  })
  .strict();

export const catalogProductListContentSchema = z
  .object({
    kind: z.literal("catalogProductList"),
    body: z.string().min(1).max(1_024),
    products: catalogProductListSchema,
  })
  .strict();

export type CatalogProductSnapshot = z.infer<
  typeof catalogProductSnapshotSchema
>;
export type CatalogContent = z.infer<typeof catalogContentSchema>;
export type CatalogProductContent = z.infer<typeof catalogProductContentSchema>;
export type CatalogProductListContent = z.infer<
  typeof catalogProductListContentSchema
>;
export type CatalogOutboundContent =
  | CatalogContent
  | CatalogProductContent
  | CatalogProductListContent;

type CatalogProductSnapshotSource = {
  retailerId: string;
  name: string;
  description: string | null;
  priceText: string | null;
  availability: CatalogAvailability;
  availableToSend?: boolean;
  imageUrl?: string | null;
};

function boundedDescription(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (!normalized) return null;
  return normalized.slice(0, 512).replace(/[\uD800-\uDBFF]$/u, "");
}

export function toCatalogProductSnapshot(
  product: CatalogProductSnapshotSource,
): CatalogProductSnapshot {
  return catalogProductSnapshotSchema.parse({
    retailerId: product.retailerId,
    name: product.name,
    description: boundedDescription(product.description),
    priceText: product.priceText,
    availability: product.availability,
  });
}
