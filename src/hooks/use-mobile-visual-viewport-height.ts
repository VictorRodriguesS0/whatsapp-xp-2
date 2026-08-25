"use client";

import { useEffect, useState } from "react";

const DYNAMIC_VIEWPORT_FALLBACK = "100dvh";

function visualViewportHeight() {
  const height = window.visualViewport?.height;
  return typeof height === "number" && Number.isFinite(height) && height > 0
    ? `${height}px`
    : DYNAMIC_VIEWPORT_FALLBACK;
}

export function useMobileVisualViewportHeight(isMobile: boolean) {
  const [height, setHeight] = useState(() => (
    isMobile && typeof window !== "undefined"
      ? visualViewportHeight()
      : DYNAMIC_VIEWPORT_FALLBACK
  ));

  useEffect(() => {
    if (!isMobile) return;

    const viewport = window.visualViewport;
    const update = () => setHeight(visualViewportHeight());
    update();
    if (!viewport) return;

    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, [isMobile]);

  return isMobile ? height : undefined;
}
