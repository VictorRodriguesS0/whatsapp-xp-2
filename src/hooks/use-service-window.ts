"use client";

import { useEffect, useMemo, useState } from "react";

import type { ServiceWindowDto } from "@/modules/messaging-policy/types";

const HOUR_MS = 60 * 60 * 1_000;
const MINUTE_MS = 60 * 1_000;

function closesAtMs(serviceWindow: ServiceWindowDto): number | null {
  if (!serviceWindow.closesAt) return null;
  const value = new Date(serviceWindow.closesAt).getTime();
  return Number.isFinite(value) ? value : null;
}

export function useServiceWindow(
  authoritative: ServiceWindowDto,
): ServiceWindowDto {
  const [now, setNow] = useState(() => Date.now());
  const closeTime = closesAtMs(authoritative);
  const shouldTick =
    authoritative.enforcement === "ACTIVE" &&
    authoritative.status === "OPEN" &&
    closeTime !== null;

  useEffect(() => {
    setNow(Date.now());
    if (!shouldTick || closeTime === null) return;
    let timer: number | null = null;
    const schedule = () => {
      const current = Date.now();
      setNow(current);
      const remaining = Math.max(0, closeTime - current);
      if (remaining === 0) return;
      timer = window.setTimeout(
        schedule,
        remaining <= HOUR_MS ? 1_000 : MINUTE_MS,
      );
    };
    schedule();
    return () => {
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [closeTime, shouldTick]);

  return useMemo(() => {
    if (
      shouldTick &&
      closeTime !== null &&
      now >= closeTime
    ) {
      return {
        enforcement: "ACTIVE",
        status: "CLOSED",
        closesAt: authoritative.closesAt,
        sendMode: "BLOCKED",
        reason: "WINDOW_EXPIRED",
        resumption: null,
      };
    }
    return authoritative;
  }, [authoritative, closeTime, now, shouldTick]);
}

export function formatServiceWindowStatus(
  serviceWindow: ServiceWindowDto,
  now = Date.now(),
): string | null {
  if (serviceWindow.enforcement !== "ACTIVE") return null;
  if (serviceWindow.sendMode === "BLOCKED") return "Retomada indisponível";
  if (serviceWindow.status !== "OPEN") {
    if (serviceWindow.sendMode === "RESUMPTION") {
      return "Janela encerrada — use um template";
    }
    if (serviceWindow.sendMode === "AWAITING_CUSTOMER") {
      return "Aguardando cliente";
    }
    if (serviceWindow.sendMode === "CONFIRMING") {
      return "Retomada em confirmação";
    }
    return "Retomada indisponível";
  }
  const closeTime = closesAtMs(serviceWindow);
  if (closeTime === null) return "Janela aberta";
  const remaining = Math.max(0, closeTime - now);
  if (remaining >= HOUR_MS) {
    const hours = Math.ceil(remaining / HOUR_MS);
    return `Janela aberta — ${hours}h restantes`;
  }
  const minutes = Math.max(1, Math.ceil(remaining / MINUTE_MS));
  return `Janela aberta — ${minutes}min restantes`;
}
