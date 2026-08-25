export const catalogAvailabilityValues = [
  "IN_STOCK",
  "OUT_OF_STOCK",
  "PREORDER",
  "AVAILABLE_FOR_ORDER",
  "DISCONTINUED",
  "UNKNOWN",
] as const;

export type CatalogAvailability = (typeof catalogAvailabilityValues)[number];

export type CatalogProductDto = {
  retailerId: string;
  name: string;
  description: string | null;
  priceText: string | null;
  availability: CatalogAvailability;
  availableToSend: boolean;
  imagePath: string | null;
};

export type CatalogPageDto = {
  products: CatalogProductDto[];
  nextCursor: string | null;
  freshness: "FRESH" | "STALE";
  fetchedAt: string;
};

export type CatalogStatusDto = {
  configured: boolean;
  ready: boolean;
  catalog: {
    idSuffix: string;
    name: string;
    productCount: number | null;
  } | null;
  commerce: {
    catalogVisible: boolean;
    cartEnabled: boolean;
  } | null;
  freshness: "FRESH" | "STALE" | "UNAVAILABLE";
  lastSuccessAt: string | null;
  errorCode: string | null;
};
