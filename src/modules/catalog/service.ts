import "server-only";

import { HttpError } from "@/lib/http";
import { requireAdmin, requireUser } from "@/modules/auth/guards";
import type { SessionUser } from "@/modules/auth/session";

import { createBoundedTtlCache, type CacheLookup } from "./cache";
import {
  MetaCatalogGraphError,
  type CatalogCommerceSettings,
  type CatalogSummary,
  type MetaCatalogGraphClient,
  type MetaCatalogGraphErrorCode,
} from "./graph-client";
import {
  catalogSearchInputSchema,
  toCatalogProductDto,
  type CatalogProduct,
  type CatalogProductPage,
} from "./schemas";
import type { CatalogPageDto, CatalogStatusDto } from "./types";

export type CatalogServiceErrorCode =
  | MetaCatalogGraphErrorCode
  | "CATALOG_NOT_CONFIGURED"
  | "CATALOG_PRODUCT_NOT_FOUND";

export class CatalogServiceError extends Error {
  constructor(public readonly code: CatalogServiceErrorCode) {
    super(code);
    this.name = "CatalogServiceError";
  }
}

export type CatalogService = {
  getStatus(actor: SessionUser): Promise<CatalogStatusDto>;
  getReadiness(actor: SessionUser): Promise<boolean>;
  refreshStatus(actor: SessionUser): Promise<CatalogStatusDto>;
  searchProducts(
    actor: SessionUser,
    input: { query: string; cursor: string | null; limit: number },
  ): Promise<CatalogPageDto>;
  resolveProduct(retailerId: string): Promise<CatalogProduct>;
  invalidate(): void;
};

type RemoteStatus = {
  summary: CatalogSummary;
  commerce: CatalogCommerceSettings;
};

type SearchCursor = {
  version: 1;
  after: string | null;
  offset: number;
};

const DEFAULT_TTL_MS = 5 * 60_000;
const MANUAL_REFRESH_INTERVAL_MS = 60_000;
const MAXIMUM_SEARCH_PAGES = 3;
const GRAPH_PAGE_SIZE = 50;

function errorCode(error: unknown): CatalogServiceErrorCode {
  return error instanceof MetaCatalogGraphError
    ? error.code
    : error instanceof CatalogServiceError
      ? error.code
      : "META_UNAVAILABLE";
}

function isTransient(code: CatalogServiceErrorCode): boolean {
  return code === "META_TIMEOUT" || code === "META_RATE_LIMITED" || code === "META_UNAVAILABLE";
}

function statusDto(input: {
  catalogId: string;
  cached: CacheLookup<RemoteStatus> | null;
  errorCode: CatalogServiceErrorCode | null;
}): CatalogStatusDto {
  const data = input.cached?.value ?? null;
  const freshness = data
    ? input.cached?.freshness ?? "STALE"
    : "UNAVAILABLE";
  return {
    configured: true,
    ready:
      freshness === "FRESH" &&
      input.errorCode === null &&
      data !== null &&
      data.summary.productCount > 0 &&
      data.commerce.catalogVisible &&
      data.commerce.cartEnabled,
    catalog: data
      ? {
          idSuffix: `…${input.catalogId.slice(-6)}`,
          name: data.summary.name,
          productCount: data.summary.productCount,
        }
      : null,
    commerce: data
      ? {
          catalogVisible: data.commerce.catalogVisible,
          cartEnabled: data.commerce.cartEnabled,
        }
      : null,
    freshness,
    lastSuccessAt: input.cached
      ? new Date(input.cached.fetchedAt).toISOString()
      : null,
    errorCode: input.errorCode,
  };
}

function normalizedSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("pt-BR")
    .trim()
    .replace(/\s+/gu, " ");
}

function matches(product: CatalogProduct, query: string): boolean {
  if (!query) return true;
  return [product.retailerId, product.name, product.description ?? ""]
    .some((value) => normalizedSearchText(value).includes(query));
}

function encodeCursor(cursor: SearchCursor): string {
  const encoded = Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
  if (encoded.length > 1024) throw new CatalogServiceError("META_INVALID_RESPONSE");
  return encoded;
}

function decodeCursor(value: string | null): SearchCursor {
  if (value === null) return { version: 1, after: null, offset: 0 };
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) throw new Error("invalid");
    const candidate = parsed as Record<string, unknown>;
    if (
      candidate.version !== 1 ||
      !(candidate.after === null || (
        typeof candidate.after === "string" &&
        candidate.after.length > 0 &&
        candidate.after.length <= 512 &&
        !/[\u0000-\u001f\u007f-\u009f]/u.test(candidate.after)
      )) ||
      !Number.isInteger(candidate.offset) ||
      (candidate.offset as number) < 0 ||
      (candidate.offset as number) > GRAPH_PAGE_SIZE
    ) throw new Error("invalid");
    return candidate as unknown as SearchCursor;
  } catch {
    throw new HttpError(400, "Cursor de catálogo inválido", "CATALOG_INVALID_CURSOR");
  }
}

export function createCatalogService(input: {
  catalogId: string | null;
  client: MetaCatalogGraphClient | null;
  now?: () => Date;
  ttlMs?: number;
}): CatalogService {
  const now = input.now ?? (() => new Date());
  const nowMs = () => now().getTime();
  const statusCache = createBoundedTtlCache<RemoteStatus>({
    ttlMs: input.ttlMs ?? DEFAULT_TTL_MS,
    maximumEntries: 1,
    maximumWeight: 1,
    now: nowMs,
  });
  const pageCache = createBoundedTtlCache<CatalogProductPage>({
    ttlMs: input.ttlMs ?? DEFAULT_TTL_MS,
    maximumEntries: 100,
    maximumWeight: 2_000,
    weight: (page) => Math.max(1, page.products.length),
    now: nowMs,
  });
  const exactProductCache = createBoundedTtlCache<CatalogProduct>({
    ttlMs: input.ttlMs ?? DEFAULT_TTL_MS,
    maximumEntries: 200,
    maximumWeight: 200,
    now: nowMs,
  });
  let lastManualRefreshAt: number | null = null;

  function requireConfigured(): {
    catalogId: string;
    client: MetaCatalogGraphClient;
  } {
    if (!input.catalogId || !input.client) {
      throw new CatalogServiceError("CATALOG_NOT_CONFIGURED");
    }
    return { catalogId: input.catalogId, client: input.client };
  }

  async function loadStatus(force: boolean): Promise<CatalogStatusDto> {
    const { catalogId, client } = requireConfigured();
    const previous = force ? statusCache.peek("status") : null;
    if (force) statusCache.invalidate("status");
    try {
      const cached = await statusCache.load("status", async () => {
        const [summary, commerce] = await Promise.all([
          client.getCatalogSummary(),
          client.getCommerceSettings(),
        ]);
        if (summary.id !== catalogId) {
          throw new MetaCatalogGraphError("META_INVALID_RESPONSE");
        }
        return { summary, commerce };
      });
      return statusDto({ catalogId, cached, errorCode: null });
    } catch (error) {
      const code = errorCode(error);
      const stale = statusCache.peek("status") ?? previous;
      if (stale && isTransient(code)) {
        return statusDto({
          catalogId,
          cached: { ...stale, freshness: "STALE" },
          errorCode: code,
        });
      }
      statusCache.invalidate("status");
      return statusDto({ catalogId, cached: null, errorCode: code });
    }
  }

  async function loadPage(
    after: string | null,
  ): Promise<CacheLookup<CatalogProductPage>> {
    const { client } = requireConfigured();
    const key = `page:${after ?? "first"}`;
    try {
      return await pageCache.load(key, () => client.listProducts({
        query: "",
        cursor: after,
        limit: GRAPH_PAGE_SIZE,
      }));
    } catch (error) {
      const code = errorCode(error);
      const stale = pageCache.peek(key);
      if (stale && isTransient(code)) {
        return { ...stale, freshness: "STALE" };
      }
      if (!isTransient(code)) pageCache.invalidate();
      throw new CatalogServiceError(code);
    }
  }

  return {
    async getStatus(actor) {
      await requireAdmin(async () => actor);
      if (!input.catalogId || !input.client) {
        return {
          configured: false,
          ready: false,
          catalog: null,
          commerce: null,
          freshness: "UNAVAILABLE",
          lastSuccessAt: null,
          errorCode: "CATALOG_NOT_CONFIGURED",
        };
      }
      return loadStatus(false);
    },

    async getReadiness(actor) {
      await requireUser(async () => actor);
      if (!input.catalogId || !input.client) return false;
      return (await loadStatus(false)).ready;
    },

    async refreshStatus(actor) {
      await requireAdmin(async () => actor);
      if (!input.catalogId || !input.client) return this.getStatus(actor);
      const at = nowMs();
      if (
        lastManualRefreshAt !== null &&
        at - lastManualRefreshAt < MANUAL_REFRESH_INTERVAL_MS
      ) {
        throw new HttpError(429, "Aguarde antes de atualizar novamente", "CATALOG_REFRESH_RATE_LIMITED");
      }
      lastManualRefreshAt = at;
      return loadStatus(true);
    },

    async searchProducts(actor, rawInput) {
      await requireUser(async () => actor);
      requireConfigured();
      const parsed = catalogSearchInputSchema.safeParse(rawInput);
      if (!parsed.success) {
        throw new HttpError(400, "Busca de catálogo inválida", "CATALOG_INVALID_SEARCH");
      }
      const query = normalizedSearchText(parsed.data.query);
      let cursor = decodeCursor(parsed.data.cursor);
      const products: CatalogProduct[] = [];
      let freshness: "FRESH" | "STALE" = "FRESH";
      let fetchedAt: number | null = null;
      let nextCursor: string | null = null;

      for (let pageIndex = 0; pageIndex < MAXIMUM_SEARCH_PAGES; pageIndex += 1) {
        const pageStart = cursor.after;
        const page = await loadPage(pageStart);
        if (page.freshness === "STALE") freshness = "STALE";
        fetchedAt = fetchedAt === null
          ? page.fetchedAt
          : Math.min(fetchedAt, page.fetchedAt);
        const matching = page.value.products.filter((item) => matches(item, query));
        const remaining = matching.slice(cursor.offset);
        const capacity = parsed.data.limit - products.length;
        products.push(...remaining.slice(0, capacity));

        if (remaining.length > capacity) {
          nextCursor = encodeCursor({
            version: 1,
            after: pageStart,
            offset: cursor.offset + capacity,
          });
          break;
        }
        if (products.length >= parsed.data.limit) {
          nextCursor = page.value.nextCursor
            ? encodeCursor({ version: 1, after: page.value.nextCursor, offset: 0 })
            : null;
          break;
        }
        if (!page.value.nextCursor) {
          nextCursor = null;
          break;
        }
        cursor = { version: 1, after: page.value.nextCursor, offset: 0 };
        nextCursor = encodeCursor(cursor);
      }

      return {
        products: products.map(toCatalogProductDto),
        nextCursor,
        freshness,
        fetchedAt: new Date(fetchedAt ?? nowMs()).toISOString(),
      };
    },

    async resolveProduct(retailerId) {
      const { client } = requireConfigured();
      const key = `product:${retailerId}`;
      try {
        const cached = await exactProductCache.load(key, async () => {
          const products = await client.getProductsByRetailerIds([retailerId]);
          const product = products.find(
            (candidate) => candidate.retailerId === retailerId,
          );
          if (!product) {
            throw new CatalogServiceError("CATALOG_PRODUCT_NOT_FOUND");
          }
          return product;
        });
        return cached.value;
      } catch (error) {
        const code = errorCode(error);
        if (!isTransient(code)) exactProductCache.invalidate(key);
        throw new CatalogServiceError(code);
      }
    },

    invalidate() {
      statusCache.invalidate();
      pageCache.invalidate();
      exactProductCache.invalidate();
    },
  };
}
