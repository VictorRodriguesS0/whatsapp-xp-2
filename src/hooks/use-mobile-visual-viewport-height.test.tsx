import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useMobileVisualViewportHeight } from "./use-mobile-visual-viewport-height";

describe("useMobileVisualViewportHeight", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("tracks VisualViewport resize and scroll events while mobile", () => {
    const viewport = Object.assign(new EventTarget(), { height: 640 });
    const addEventListener = vi.spyOn(viewport, "addEventListener");
    vi.stubGlobal("visualViewport", viewport);

    const hook = renderHook(() => useMobileVisualViewportHeight(true));

    expect(hook.result.current).toBe("640px");
    expect(addEventListener).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(addEventListener).toHaveBeenCalledWith("scroll", expect.any(Function));

    act(() => {
      viewport.height = 412.5;
      viewport.dispatchEvent(new Event("resize"));
    });
    expect(hook.result.current).toBe("412.5px");

    act(() => {
      viewport.height = 401;
      viewport.dispatchEvent(new Event("scroll"));
    });
    expect(hook.result.current).toBe("401px");
  });

  it("falls back to 100dvh and cleans up both listeners on desktop or unmount", () => {
    const viewport = Object.assign(new EventTarget(), { height: 640 });
    const removeEventListener = vi.spyOn(viewport, "removeEventListener");
    vi.stubGlobal("visualViewport", viewport);

    const hook = renderHook(
      ({ mobile }) => useMobileVisualViewportHeight(mobile),
      { initialProps: { mobile: true } },
    );
    hook.rerender({ mobile: false });

    expect(hook.result.current).toBeUndefined();
    expect(removeEventListener).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(removeEventListener).toHaveBeenCalledWith("scroll", expect.any(Function));

    vi.stubGlobal("visualViewport", undefined);
    hook.rerender({ mobile: true });
    expect(hook.result.current).toBe("100dvh");
    hook.unmount();
  });
});
