import "server-only";

import {
  catalogProductPageSchema,
  catalogRetailerIdSchema,
  catalogSearchInputSchema,
  normalizeCatalogProduct,
  type CatalogProduct,
  type CatalogProductPage,
} from "./schemas";

export type MetaCatalogGraphErrorCode =
  | "CATALOG_PERMISSION_REQUIRED"
  | "CATALOG_NOT_FOUND"
  | "META_TIMEOUT"
  | "META_RATE_LIMITED"
  | "META_UNAVAILABLE"
  | "META_INVALID_RESPONSE";

export class MetaCatalogGraphError extends Error {
  constructor(public readonly code: MetaCatalogGraphErrorCode) {
    super(code);
    this.name = "MetaCatalogGraphError";
  }
}

export type CatalogSummary = {
  id: string;
  name: string;
  productCount: number;
};

export type CatalogCommerceSettings = {
  catalogVisible: boolean;
  cartEnabled: boolean;
};

export type MetaCatalogGraphClient = {
  getCatalogSummary(): Promise<CatalogSummary>;
  listProducts(input: {
    query: string;
    cursor: string | null;
    limit: number;
  }): Promise<CatalogProductPage>;
  getProductsByRetailerIds(ids: readonly string[]): Promise<CatalogProduct[]>;
  getCommerceSettings(): Promise<CatalogCommerceSettings>;
};

type MetaCatalogGraphClientConfig = {
  graphVersion: string;
  catalogId: string;
  phoneNumberId: string;
  accessToken: string;
  timeoutMs: number;
  fetcher?: typeof fetch;
};

type JsonRecord = Record<string, unknown>;

const GRAPH_ORIGIN = "https://graph.facebook.com";
const MAXIMUM_JSON_BYTES = 2 * 1024 * 1024;
const PRODUCT_FIELDS = [
  "retailer_id",
  "name",
  "description",
  "price",
  "currency",
  "availability",
  "visibility",
  "image_url",
].join(",");
const unsafeControlPattern = /[\u0000-\u001f\u007f-\u009f]/u;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function publicCodeForStatus(
  status: number,
  graphCode?: number,
): MetaCatalogGraphErrorCode {
  if (status === 401 || status === 403) return "CATALOG_PERMISSION_REQUIRED";
  if (status === 404) return "CATALOG_NOT_FOUND";
  if (status === 429) return "META_RATE_LIMITED";
  if (status === 408 || status >= 500) return "META_UNAVAILABLE";
  if (status === 400 && (graphCode === 10 || graphCode === 200)) {
    return "CATALOG_PERMISSION_REQUIRED";
  }
  if (status === 400 && graphCode === 100) return "CATALOG_NOT_FOUND";
  return "META_INVALID_RESPONSE";
}

function boundedString(
  value: unknown,
  maximumLength: number,
  pattern?: RegExp,
): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumLength ||
    unsafeControlPattern.test(value) ||
    (pattern && !pattern.test(value))
  ) {
    return null;
  }
  return value;
}

function boundedName(value: unknown): string | null {
  const raw = boundedString(value, 512);
  if (!raw) return null;
  const normalized = raw.trim().replace(/\s+/gu, " ");
  return normalized || null;
}

async function boundedJson(response: Response): Promise<JsonRecord> {
  if (!response.ok && response.status !== 400) {
    await response.body?.cancel().catch(() => undefined);
    throw new MetaCatalogGraphError(publicCodeForStatus(response.status));
  }
  if (!response.body) throw new MetaCatalogGraphError("META_INVALID_RESPONSE");

  const contentType = response.headers.get("content-type")?.toLowerCase();
  if (!contentType?.startsWith("application/json")) {
    await response.body.cancel().catch(() => undefined);
    throw new MetaCatalogGraphError("META_INVALID_RESPONSE");
  }

  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAXIMUM_JSON_BYTES) {
    await response.body.cancel().catch(() => undefined);
    throw new MetaCatalogGraphError("META_INVALID_RESPONSE");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > MAXIMUM_JSON_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new MetaCatalogGraphError("META_INVALID_RESPONSE");
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  try {
    const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
    const parsed: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    if (!isRecord(parsed)) throw new MetaCatalogGraphError("META_INVALID_RESPONSE");
    if (!response.ok) {
      const graphError = isRecord(parsed.error) ? parsed.error : null;
      const graphCodeCandidate = graphError?.code;
      const graphCode = Number.isSafeInteger(graphCodeCandidate)
        ? graphCodeCandidate as number
        : undefined;
      throw new MetaCatalogGraphError(
        publicCodeForStatus(response.status, graphCode),
      );
    }
    return parsed;
  } catch (error) {
    if (error instanceof MetaCatalogGraphError) throw error;
    throw new MetaCatalogGraphError("META_INVALID_RESPONSE");
  }
}

function productsFromPayload(
  payload: JsonRecord,
  maximumProducts: number,
): CatalogProductPage {
  if (!Array.isArray(payload.data) || payload.data.length > maximumProducts) {
    throw new MetaCatalogGraphError("META_INVALID_RESPONSE");
  }

  const products = payload.data.map(normalizeCatalogProduct);
  if (products.some((product) => product === null)) {
    throw new MetaCatalogGraphError("META_INVALID_RESPONSE");
  }

  let nextCursor: string | null = null;
  if (payload.paging !== undefined && payload.paging !== null) {
    if (!isRecord(payload.paging)) {
      throw new MetaCatalogGraphError("META_INVALID_RESPONSE");
    }
    const cursors = payload.paging.cursors;
    if (cursors !== undefined && cursors !== null) {
      if (!isRecord(cursors)) {
        throw new MetaCatalogGraphError("META_INVALID_RESPONSE");
      }
      if (cursors.after !== undefined && cursors.after !== null) {
        nextCursor = boundedString(cursors.after, 1024);
        if (!nextCursor) {
          throw new MetaCatalogGraphError("META_INVALID_RESPONSE");
        }
      }
    }
  }

  return catalogProductPageSchema.parse({
    products: products as CatalogProduct[],
    nextCursor,
  });
}

export function createMetaCatalogGraphClient(
  config: MetaCatalogGraphClientConfig,
): MetaCatalogGraphClient {
  const fetcher = config.fetcher ?? fetch;

  if (
    !/^v\d+\.\d+$/u.test(config.graphVersion) ||
    !/^\d{1,64}$/u.test(config.catalogId) ||
    !/^\d{1,64}$/u.test(config.phoneNumberId) ||
    !config.accessToken ||
    !Number.isInteger(config.timeoutMs) ||
    config.timeoutMs < 1
  ) {
    throw new MetaCatalogGraphError("META_INVALID_RESPONSE");
  }

  const endpoint = (path: string) =>
    `${GRAPH_ORIGIN}/${encodeURIComponent(config.graphVersion)}/${path}`;

  async function get(url: URL): Promise<JsonRecord> {
    const signal = AbortSignal.timeout(config.timeoutMs);
    try {
      return await boundedJson(
        await fetcher(url.toString(), {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${config.accessToken}`,
          },
          signal,
        }),
      );
    } catch (error) {
      if (error instanceof MetaCatalogGraphError) throw error;
      if (
        signal.aborted ||
        (error instanceof DOMException && error.name === "AbortError")
      ) {
        throw new MetaCatalogGraphError("META_TIMEOUT");
      }
      throw new MetaCatalogGraphError("META_UNAVAILABLE");
    }
  }

  function productsUrl(): URL {
    const url = new URL(
      endpoint(`${encodeURIComponent(config.catalogId)}/products`),
    );
    url.searchParams.set("fields", PRODUCT_FIELDS);
    url.searchParams.set("return_only_approved_products", "true");
    return url;
  }

  return {
    async getCatalogSummary() {
      const url = new URL(endpoint(encodeURIComponent(config.catalogId)));
      url.searchParams.set("fields", "id,name,product_count");
      const payload = await get(url);
      const name = boundedName(payload.name);
      if (
        payload.id !== config.catalogId ||
        !name ||
        !Number.isSafeInteger(payload.product_count) ||
        (payload.product_count as number) < 0 ||
        (payload.product_count as number) > 10_000_000
      ) {
        throw new MetaCatalogGraphError("META_INVALID_RESPONSE");
      }
      return {
        id: config.catalogId,
        name,
        productCount: payload.product_count as number,
      };
    },

    async listProducts(input) {
      const parsed = catalogSearchInputSchema.parse(input);
      const url = productsUrl();
      // Meta documents a generic filter object here, but not a stable
      // name/description text-search contract. Search remains bounded and local.
      url.searchParams.set("limit", String(parsed.limit));
      if (parsed.cursor) url.searchParams.set("after", parsed.cursor);
      const payload = await get(url);
      return productsFromPayload(payload, parsed.limit);
    },

    async getProductsByRetailerIds(ids) {
      const uniqueIds = Array.from(new Set(ids));
      if (
        uniqueIds.length > 30 ||
        uniqueIds.some((id) => !catalogRetailerIdSchema.safeParse(id).success)
      ) {
        throw new MetaCatalogGraphError("META_INVALID_RESPONSE");
      }
      if (uniqueIds.length === 0) return [];

      const url = productsUrl();
      url.searchParams.set("limit", String(uniqueIds.length));
      url.searchParams.set(
        "filter",
        JSON.stringify({ retailer_id: { is_any: uniqueIds } }),
      );
      const page = productsFromPayload(await get(url), uniqueIds.length);
      const requestedIds = new Set(uniqueIds);
      if (page.products.some((product) => !requestedIds.has(product.retailerId))) {
        throw new MetaCatalogGraphError("META_INVALID_RESPONSE");
      }
      const productsById = new Map(
        page.products.map((product) => [product.retailerId, product]),
      );
      return uniqueIds.flatMap((id) => {
        const product = productsById.get(id);
        return product ? [product] : [];
      });
    },

    async getCommerceSettings() {
      const url = new URL(
        endpoint(
          `${encodeURIComponent(config.phoneNumberId)}/whatsapp_commerce_settings`,
        ),
      );
      url.searchParams.set("fields", "is_catalog_visible,is_cart_enabled");
      const payload = await get(url);
      if (
        !Array.isArray(payload.data) ||
        payload.data.length !== 1 ||
        !isRecord(payload.data[0]) ||
        typeof payload.data[0].is_catalog_visible !== "boolean" ||
        typeof payload.data[0].is_cart_enabled !== "boolean"
      ) {
        throw new MetaCatalogGraphError("META_INVALID_RESPONSE");
      }
      return {
        catalogVisible: payload.data[0].is_catalog_visible,
        cartEnabled: payload.data[0].is_cart_enabled,
      };
    },
  };
}
