import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useMobileInboxHistory } from "./use-mobile-inbox-history";

describe("useMobileInboxHistory", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", window.location.href);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, "", window.location.href);
  });

  it("creates one opaque thread layer, replaces it when switching and adds one details layer", () => {
    const pushState = vi.spyOn(window.history, "pushState");
    const replaceState = vi.spyOn(window.history, "replaceState");
    const hook = renderHook(() => useMobileInboxHistory({
      isMobile: true,
      threadOpen: true,
      detailsOpen: false,
      closeThread: vi.fn(),
      closeDetails: vi.fn(),
    }));

    act(() => hook.result.current.enterThread());
    expect(pushState).toHaveBeenCalledWith(
      { __xpInboxLayer: "thread" },
      "",
      window.location.href,
    );
    expect(JSON.stringify(pushState.mock.calls[0][0])).not.toMatch(/contact|phone|conversation|message|id/i);

    act(() => hook.result.current.switchThread());
    expect(pushState).toHaveBeenCalledOnce();
    expect(replaceState).toHaveBeenCalledWith(
      { __xpInboxLayer: "thread" },
      "",
      window.location.href,
    );

    act(() => hook.result.current.enterDetails());
    expect(pushState).toHaveBeenCalledTimes(2);
    expect(pushState).toHaveBeenLastCalledWith(
      { __xpInboxLayer: "details" },
      "",
      window.location.href,
    );
  });

  it("closes details on the first pop and the thread on the next pop", () => {
    const closeDetails = vi.fn();
    const closeThread = vi.fn();
    const { rerender } = renderHook(
      ({ detailsOpen }) => useMobileInboxHistory({
        isMobile: true,
        threadOpen: true,
        detailsOpen,
        closeThread,
        closeDetails,
      }),
      { initialProps: { detailsOpen: true } },
    );

    act(() => window.dispatchEvent(new PopStateEvent("popstate", {
      state: { __xpInboxLayer: "thread" },
    })));
    expect(closeDetails).toHaveBeenCalledOnce();
    expect(closeThread).not.toHaveBeenCalled();

    rerender({ detailsOpen: false });
    act(() => window.dispatchEvent(new PopStateEvent("popstate", { state: null })));
    expect(closeThread).toHaveBeenCalledOnce();
  });

  it("consumes visible close actions through back and falls back to local close without a marker", () => {
    const closeDetails = vi.fn();
    const closeThread = vi.fn();
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
    const hook = renderHook(() => useMobileInboxHistory({
      isMobile: true,
      threadOpen: true,
      detailsOpen: true,
      closeThread,
      closeDetails,
    }));

    window.history.replaceState({ __xpInboxLayer: "details" }, "", window.location.href);
    act(() => hook.result.current.leaveDetails());
    expect(back).toHaveBeenCalledOnce();
    expect(closeDetails).not.toHaveBeenCalled();

    window.history.replaceState({ __xpInboxLayer: "thread" }, "", window.location.href);
    act(() => hook.result.current.leaveThread());
    expect(back).toHaveBeenCalledTimes(2);
    expect(closeThread).not.toHaveBeenCalled();

    window.history.replaceState(null, "", window.location.href);
    act(() => hook.result.current.leaveDetails());
    act(() => hook.result.current.leaveThread());
    expect(closeDetails).toHaveBeenCalledOnce();
    expect(closeThread).toHaveBeenCalledOnce();
  });

  it("does not mutate history or intercept popstate on desktop", () => {
    const closeThread = vi.fn();
    const closeDetails = vi.fn();
    const pushState = vi.spyOn(window.history, "pushState");
    const replaceState = vi.spyOn(window.history, "replaceState");
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
    const hook = renderHook(() => useMobileInboxHistory({
      isMobile: false,
      threadOpen: true,
      detailsOpen: true,
      closeThread,
      closeDetails,
    }));

    act(() => {
      hook.result.current.enterThread();
      hook.result.current.switchThread();
      hook.result.current.enterDetails();
      hook.result.current.leaveThread();
      hook.result.current.leaveDetails();
      window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    });

    expect(pushState).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
    expect(closeThread).toHaveBeenCalledOnce();
    expect(closeDetails).toHaveBeenCalledOnce();
  });

  it("removes a stale current marker when the thread closes outside history", () => {
    window.history.replaceState({ __xpInboxLayer: "thread" }, "", window.location.href);
    const { rerender } = renderHook(
      ({ threadOpen }) => useMobileInboxHistory({
        isMobile: true,
        threadOpen,
        detailsOpen: false,
        closeThread: vi.fn(),
        closeDetails: vi.fn(),
      }),
      { initialProps: { threadOpen: true } },
    );

    rerender({ threadOpen: false });

    expect(window.history.state).toBeNull();
  });

  it("reconciles mobile open → desktop close → mobile reopen so back returns to the list", async () => {
    const closeThread = vi.fn();
    const closeDetails = vi.fn();
    const pushState = vi.spyOn(window.history, "pushState");
    window.history.replaceState({ __xpForeignOverlay: "menu" }, "", window.location.href);
    const hook = renderHook(
      ({ isMobile, threadOpen }) => useMobileInboxHistory({
        isMobile,
        threadOpen,
        detailsOpen: false,
        closeThread,
        closeDetails,
      }),
      { initialProps: { isMobile: true, threadOpen: false } },
    );

    act(() => hook.result.current.enterThread());
    hook.rerender({ isMobile: true, threadOpen: true });
    expect(window.history.state).toEqual({
      __xpForeignOverlay: "menu",
      __xpInboxLayer: "thread",
    });

    hook.rerender({ isMobile: false, threadOpen: true });
    expect(window.history.state).toEqual({ __xpForeignOverlay: "menu" });
    act(() => hook.result.current.leaveThread());
    expect(closeThread).toHaveBeenCalledOnce();

    hook.rerender({ isMobile: false, threadOpen: false });
    hook.rerender({ isMobile: true, threadOpen: false });
    act(() => hook.result.current.enterThread());
    hook.rerender({ isMobile: true, threadOpen: true });
    expect(pushState).toHaveBeenCalledTimes(2);
    expect(window.history.state).toMatchObject({ __xpInboxLayer: "thread" });

    closeThread.mockClear();
    window.history.back();
    await waitFor(() => expect(window.history.state).toEqual({ __xpForeignOverlay: "menu" }));
    await waitFor(() => expect(closeThread).toHaveBeenCalledOnce());
  });
});
