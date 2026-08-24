import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ServiceWindowDto } from "@/modules/messaging-policy/types";

import {
  formatServiceWindowStatus,
  useServiceWindow,
} from "./use-service-window";

const openWindow: ServiceWindowDto = {
  enforcement: "ACTIVE",
  status: "OPEN",
  closesAt: "2026-08-24T20:00:00.000Z",
  sendMode: "FREE_FORM",
  reason: null,
  resumption: null,
};

describe("useServiceWindow", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows whole remaining hours and closes locally at the exact boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24T12:00:00.000Z"));
    const hook = renderHook(() => useServiceWindow(openWindow));

    expect(formatServiceWindowStatus(hook.result.current)).toBe(
      "Janela aberta — 8h restantes",
    );
    act(() => {
      vi.setSystemTime(new Date("2026-08-24T20:00:00.000Z"));
      vi.advanceTimersByTime(60_000);
    });
    expect(hook.result.current).toMatchObject({
      enforcement: "ACTIVE",
      status: "CLOSED",
      sendMode: "BLOCKED",
      reason: "WINDOW_EXPIRED",
      resumption: null,
    });
  });

  it("never invents a local reopening or template eligibility", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24T12:00:00.000Z"));
    const closed: ServiceWindowDto = {
      ...openWindow,
      status: "CLOSED",
      closesAt: "2026-08-24T11:00:00.000Z",
      sendMode: "BLOCKED",
      reason: "TEMPLATE_UNAVAILABLE",
    };
    const hook = renderHook(({ value }) => useServiceWindow(value), {
      initialProps: { value: closed },
    });

    act(() => vi.advanceTimersByTime(24 * 60 * 60 * 1_000));
    expect(hook.result.current).toEqual(closed);
  });

  it("reports a contact restriction instead of an open-window title", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24T12:00:00.000Z"));

    expect(formatServiceWindowStatus({
      ...openWindow,
      sendMode: "BLOCKED",
      reason: "CONTACT_OPTED_OUT",
    })).toBe("Retomada indisponível");
  });
});
