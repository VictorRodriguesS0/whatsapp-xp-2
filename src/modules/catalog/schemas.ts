import "server-only";

import { z } from "zod";

import {
  catalogAvailabilityValues,
  type CatalogAvailability,
  type CatalogProductDto,
} from "./types";

const unsafeControlPattern = /[\u0000-\u001f\u007f-\u009f]/u;
const retailerIdPattern = /^[A-Za-z0-9._:-]{1,128}$/u;

export const catalogRetailerIdSchema = z.string().regex(retailerIdPattern);

function normalizedText(
  value: unknown,
  maximumLength: number,
): string | null {
  if (
    typeof value !== "string" ||
    value.length > maximumLength ||
    unsafeControlPattern.test(value)
  ) {
    return null;
  }

  const normalized = value.trim().replace(/\s+/gu, " ");
  return normalized && normalized.length <= maximumLength ? normalized : null;
}

const boundedQuerySchema = z
  .string()
  .max(120)
  .refine((value) => !unsafeControlPattern.test(value))
  .transform((value) => value.trim().replace(/\s+/gu, " "));

const opaqueCursorSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine((value) => !unsafeControlPattern.test(value));

export const catalogSearchInputSchema = z
  .object({
    query: boundedQuerySchema.default(""),
    cursor: opaqueCursorSchema.nullable().default(null),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

export type CatalogSearchInput = z.infer<typeof catalogSearchInputSchema>;

export type CatalogProduct = Omit<CatalogProductDto, "imagePath"> & {
  imageUrl: string | null;
};

const catalogProductSchema = z
  .object({
    retailerId: catalogRetailerIdSchema,
    name: z.string().min(1).max(512),
    description: z.string().max(2_000).nullable(),
    priceText: z.string().max(128).nullable(),
    availability: z.enum(catalogAvailabilityValues),
    availableToSend: z.boolean(),
    imageUrl: z.string().max(2_048).nullable(),
  })
  .strict();

export const catalogProductPageSchema = z
  .object({
    products: z.array(catalogProductSchema).max(50),
    nextCursor: opaqueCursorSchema.nullable(),
  })
  .strict();

export type CatalogProductPage = z.infer<typeof catalogProductPageSchema>;

function normalizedAvailability(value: unknown): CatalogAvailability {
  const normalized = normalizedText(value, 64)
    ?.toLowerCase()
    .replace(/[_-]+/gu, " ");

  switch (normalized) {
    case "in stock":
      return "IN_STOCK";
    case "out of stock":
      return "OUT_OF_STOCK";
    case "preorder":
    case "pre order":
      return "PREORDER";
    case "available for order":
      return "AVAILABLE_FOR_ORDER";
    case "discontinued":
      return "DISCONTINUED";
    default:
      return "UNKNOWN";
  }
}

function isPublished(value: unknown): boolean {
  const visibility = normalizedText(value, 64)?.toLowerCase();
  return visibility === "published" || visibility === "visible";
}

export function normalizeCatalogProduct(value: unknown): CatalogProduct | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const raw = value as Record<string, unknown>;
  const retailerId = normalizedText(raw.retailer_id, 128);
  const name = normalizedText(raw.name, 512);
  if (!retailerId || !retailerIdPattern.test(retailerId) || !name) return null;

  const description = raw.description == null
    ? null
    : normalizedText(raw.description, 2_000);
  if (raw.description != null && description === null) return null;

  let priceText = raw.price == null
    ? null
    : normalizedText(raw.price, 128);
  if (raw.price != null && priceText === null) return null;
  if (priceText !== null && raw.currency != null) {
    const currency = normalizedText(raw.currency, 3)?.toUpperCase();
    if (!currency || !/^[A-Z]{3}$/u.test(currency)) return null;
    priceText = `${currency} ${priceText}`;
  }

  const imageUrl = raw.image_url == null
    ? null
    : normalizedText(raw.image_url, 2_048);
  if (raw.image_url != null && imageUrl === null) return null;

  const availability = normalizedAvailability(raw.availability);
  const availableToSend = isPublished(raw.visibility) && (
    availability === "IN_STOCK" ||
    availability === "PREORDER" ||
    availability === "AVAILABLE_FOR_ORDER"
  );

  return catalogProductSchema.parse({
    retailerId,
    name,
    description,
    priceText,
    availability,
    availableToSend,
    imageUrl,
  });
}

export function toCatalogProductDto(product: CatalogProduct): CatalogProductDto {
  return {
    retailerId: product.retailerId,
    name: product.name,
    description: product.description,
    priceText: product.priceText,
    availability: product.availability,
    availableToSend: product.availableToSend,
    imagePath: product.imageUrl
      ? `/api/catalog/products/${encodeURIComponent(product.retailerId)}/image`
      : null,
  };
}
