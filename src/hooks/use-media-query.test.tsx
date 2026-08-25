import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useMediaQuery } from "./use-media-query";

describe("useMediaQuery", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("cleans up the modern change listener with the registered callback", () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
      matches: true,
      addEventListener,
      removeEventListener,
    }));

    const hook = renderHook(() => useMediaQuery("(max-width: 767px)"));
    const listener = addEventListener.mock.calls[0][1];

    expect(hook.result.current).toBe(true);
    expect(addEventListener).toHaveBeenCalledWith("change", expect.any(Function));

    hook.unmount();

    expect(removeEventListener).toHaveBeenCalledWith("change", listener);
  });

  it("falls back to the legacy listener lifecycle when change events are unavailable", () => {
    const addListener = vi.fn();
    const removeListener = vi.fn();
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
      matches: false,
      addListener,
      removeListener,
    }));

    const hook = renderHook(() => useMediaQuery("(max-width: 767px)"));
    const listener = addListener.mock.calls[0][0];

    expect(hook.result.current).toBe(false);
    expect(addListener).toHaveBeenCalledWith(expect.any(Function));

    hook.unmount();

    expect(removeListener).toHaveBeenCalledWith(listener);
  });
});
