"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  MAX_CATALOG_DESCRIPTION_LENGTH,
  type CatalogPageDto,
  type CatalogProductDto,
} from "@/modules/catalog/types";

const PRODUCT_KEYS = new Set([
  "retailerId",
  "name",
  "description",
  "priceText",
  "availability",
  "availableToSend",
  "imagePath",
]);
const PAGE_KEYS = new Set(["products", "nextCursor", "freshness", "fetchedAt"]);
const AVAILABILITY = new Set([
  "IN_STOCK",
  "OUT_OF_STOCK",
  "PREORDER",
  "AVAILABLE_FOR_ORDER",
  "DISCONTINUED",
  "UNKNOWN",
]);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function product(value: unknown): CatalogProductDto | null {
  const item = record(value);
  if (!item || !Object.keys(item).every((key) => PRODUCT_KEYS.has(key))) return null;
  if (
    typeof item.retailerId !== "string" ||
    !/^[A-Za-z0-9._:-]{1,128}$/u.test(item.retailerId) ||
    typeof item.name !== "string" ||
    item.name.length < 1 ||
    item.name.length > 512 ||
    !(item.description === null || (
      typeof item.description === "string" &&
      item.description.length <= MAX_CATALOG_DESCRIPTION_LENGTH
    )) ||
    !(item.priceText === null || (typeof item.priceText === "string" && item.priceText.length <= 128)) ||
    typeof item.availability !== "string" ||
    !AVAILABILITY.has(item.availability) ||
    typeof item.availableToSend !== "boolean" ||
    !(item.imagePath === null || (
      typeof item.imagePath === "string" &&
      item.imagePath.length <= 512 &&
      item.imagePath.startsWith("/api/catalog/products/") &&
      item.imagePath.endsWith("/image") &&
      !item.imagePath.includes("..") &&
      !item.imagePath.includes("://")
    ))
  ) return null;
  return {
    retailerId: item.retailerId,
    name: item.name,
    description: item.description as string | null,
    priceText: item.priceText as string | null,
    availability: item.availability as CatalogProductDto["availability"],
    availableToSend: item.availableToSend,
    imagePath: item.imagePath as string | null,
  };
}

function page(value: unknown): CatalogPageDto | null {
  const candidate = record(value);
  if (!candidate || !Object.keys(candidate).every((key) => PAGE_KEYS.has(key))) return null;
  if (
    !Array.isArray(candidate.products) ||
    candidate.products.length > 50 ||
    !(candidate.nextCursor === null || (typeof candidate.nextCursor === "string" && candidate.nextCursor.length <= 1_024)) ||
    !["FRESH", "STALE"].includes(String(candidate.freshness)) ||
    typeof candidate.fetchedAt !== "string" ||
    Number.isNaN(Date.parse(candidate.fetchedAt))
  ) return null;
  const products = candidate.products.map(product);
  if (products.some((item) => item === null)) return null;
  return {
    products: products as CatalogProductDto[],
    nextCursor: candidate.nextCursor as string | null,
    freshness: candidate.freshness as CatalogPageDto["freshness"],
    fetchedAt: candidate.fetchedAt,
  };
}

export function useCatalogProducts({
  conversationId,
  open,
}: {
  conversationId: string;
  open: boolean;
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<CatalogProductDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [freshness, setFreshness] = useState<"FRESH" | "STALE">("FRESH");
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const sequence = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
    };
  }, []);

  useEffect(() => {
    setQuery("");
    setItems([]);
    setNextCursor(null);
    setFreshness("FRESH");
    setError(null);
  }, [conversationId]);

  const load = useCallback(async (
    requestedQuery: string,
    cursor: string | null,
    append: boolean,
  ): Promise<void> => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const currentSequence = ++sequence.current;
    if (mounted.current) {
      setError(null);
      if (append) setLoadingMore(true);
      else setLoading(true);
    }
    try {
      const params = new URLSearchParams({ limit: "20", query: requestedQuery });
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/catalog/products?${params.toString()}`, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      const payload = await response.json() as { data?: unknown };
      if (!response.ok) throw new Error("request failed");
      const parsed = page(payload.data);
      if (!parsed) {
        if (mounted.current && currentSequence === sequence.current) {
          if (!append) setItems([]);
          setError("Resposta de catálogo inválida.");
        }
        return;
      }
      if (!mounted.current || controller.signal.aborted || currentSequence !== sequence.current) return;
      setItems((current) => {
        if (!append) return parsed.products;
        const known = new Set(current.map(({ retailerId }) => retailerId));
        return [...current, ...parsed.products.filter(({ retailerId }) => !known.has(retailerId))];
      });
      setNextCursor(parsed.nextCursor);
      setFreshness((current) => append && current === "STALE" ? "STALE" : parsed.freshness);
    } catch {
      if (!controller.signal.aborted && mounted.current && currentSequence === sequence.current) {
        if (!append) setItems([]);
        setError("Não foi possível carregar os produtos.");
      }
    } finally {
      if (mounted.current && currentSequence === sequence.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!open) {
      request.current?.abort();
      setLoading(false);
      setLoadingMore(false);
      return;
    }
    const delay = query ? 250 : 0;
    const timer = window.setTimeout(() => void load(query, null, false), delay);
    return () => {
      window.clearTimeout(timer);
      request.current?.abort();
    };
  }, [conversationId, load, open, query]);

  const loadMore = useCallback(() => {
    if (!nextCursor || loading || loadingMore) return Promise.resolve();
    return load(query, nextCursor, true);
  }, [load, loading, loadingMore, nextCursor, query]);

  const retry = useCallback(() => load(query, null, false), [load, query]);

  return {
    query,
    setQuery,
    items,
    nextCursor,
    freshness,
    loading,
    loadingMore,
    error,
    retry,
    loadMore,
  };
}
