"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { CatalogStatusDto } from "@/modules/catalog/types";

const ROOT_KEYS = new Set([
  "configured",
  "ready",
  "catalog",
  "commerce",
  "freshness",
  "lastSuccessAt",
  "errorCode",
]);

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseCatalogStatus(value: unknown): CatalogStatusDto | null {
  const root = record(value);
  if (!root || !Object.keys(root).every((key) => ROOT_KEYS.has(key))) return null;
  if (typeof root.configured !== "boolean" || typeof root.ready !== "boolean") return null;
  if (!["FRESH", "STALE", "UNAVAILABLE"].includes(String(root.freshness))) return null;
  if (!(root.errorCode === null || (typeof root.errorCode === "string" && root.errorCode.length <= 64))) return null;
  if (!(root.lastSuccessAt === null || (
    typeof root.lastSuccessAt === "string" &&
    root.lastSuccessAt.length <= 64 &&
    !Number.isNaN(Date.parse(root.lastSuccessAt))
  ))) return null;

  let catalog: CatalogStatusDto["catalog"] = null;
  if (root.catalog !== null) {
    const candidate = record(root.catalog);
    if (!candidate || !hasOnlyKeys(candidate, ["idSuffix", "name", "productCount"])) return null;
    if (
      typeof candidate.idSuffix !== "string" ||
      !/^…\d{1,6}$/u.test(candidate.idSuffix) ||
      typeof candidate.name !== "string" ||
      candidate.name.length < 1 ||
      candidate.name.length > 512 ||
      !(candidate.productCount === null || (
        Number.isInteger(candidate.productCount) &&
        (candidate.productCount as number) >= 0
      ))
    ) return null;
    catalog = {
      idSuffix: candidate.idSuffix,
      name: candidate.name,
      productCount: candidate.productCount as number | null,
    };
  }

  let commerce: CatalogStatusDto["commerce"] = null;
  if (root.commerce !== null) {
    const candidate = record(root.commerce);
    if (
      !candidate ||
      !hasOnlyKeys(candidate, ["catalogVisible", "cartEnabled"]) ||
      typeof candidate.catalogVisible !== "boolean" ||
      typeof candidate.cartEnabled !== "boolean"
    ) return null;
    commerce = {
      catalogVisible: candidate.catalogVisible,
      cartEnabled: candidate.cartEnabled,
    };
  }

  return {
    configured: root.configured,
    ready: root.ready,
    catalog,
    commerce,
    freshness: root.freshness as CatalogStatusDto["freshness"],
    lastSuccessAt: root.lastSuccessAt as string | null,
    errorCode: root.errorCode as string | null,
  };
}

export function useCatalogStatus(initialStatus: CatalogStatusDto) {
  const [status, setStatus] = useState(initialStatus);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const mounted = useRef(true);
  const controller = useRef<AbortController | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);

  const refresh = useCallback((): Promise<void> => {
    if (inFlight.current) return inFlight.current;
    const requestController = new AbortController();
    controller.current = requestController;
    if (mounted.current) {
      setRefreshing(true);
      setNotice(null);
    }
    const operation = (async () => {
      try {
        const response = await fetch("/api/settings/whatsapp/catalog/refresh", {
          method: "POST",
          headers: { Accept: "application/json" },
          signal: requestController.signal,
        });
        const payload = await response.json() as {
          data?: unknown;
          error?: { code?: unknown } | null;
        };
        if (requestController.signal.aborted || !mounted.current) return;
        if (response.status === 429 || payload.error?.code === "RATE_LIMITED") {
          setNotice("Aguarde um minuto antes de atualizar novamente.");
          return;
        }
        if (!response.ok) {
          setNotice("Não foi possível atualizar o catálogo agora.");
          return;
        }
        const parsed = parseCatalogStatus(payload.data);
        if (!parsed) {
          setNotice("Não foi possível validar a resposta do servidor.");
          return;
        }
        setStatus(parsed);
        setNotice("Dados do catálogo atualizados.");
      } catch {
        if (!requestController.signal.aborted && mounted.current) {
          setNotice("Sem conexão. Confira sua rede e tente novamente.");
        }
      } finally {
        inFlight.current = null;
        if (controller.current === requestController) controller.current = null;
        if (mounted.current) setRefreshing(false);
      }
    })();
    inFlight.current = operation;
    return operation;
  }, []);

  return { status, refreshing, notice, refresh };
}
