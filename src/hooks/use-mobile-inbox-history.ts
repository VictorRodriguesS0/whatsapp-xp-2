"use client";

import { useCallback, useEffect, useRef } from "react";

const INBOX_LAYER_KEY = "__xpInboxLayer";

type InboxLayer = "thread" | "details";

type MobileInboxHistoryOptions = {
  isMobile: () => boolean;
  threadOpen: boolean;
  detailsOpen: boolean;
  closeThread: () => void;
  closeDetails: () => void;
};

function objectState(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function layerFromState(value: unknown): InboxLayer | null {
  const layer = objectState(value)[INBOX_LAYER_KEY];
  return layer === "thread" || layer === "details" ? layer : null;
}

function stateWithLayer(layer: InboxLayer): Record<string, unknown> {
  return { ...objectState(window.history.state), [INBOX_LAYER_KEY]: layer };
}

function stateWithoutLayer(): Record<string, unknown> | null {
  const state = { ...objectState(window.history.state) };
  delete state[INBOX_LAYER_KEY];
  return Object.keys(state).length > 0 ? state : null;
}

function currentUrl() {
  return window.location.href;
}

export function useMobileInboxHistory(options: MobileInboxHistoryOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const enterThread = useCallback(() => {
    if (!optionsRef.current.isMobile()) return;
    const state = stateWithLayer("thread");
    if (layerFromState(window.history.state) === "thread") {
      window.history.replaceState(state, "", currentUrl());
    } else {
      window.history.pushState(state, "", currentUrl());
    }
  }, []);

  const switchThread = useCallback(() => {
    if (!optionsRef.current.isMobile()) return;
    window.history.replaceState(stateWithLayer("thread"), "", currentUrl());
  }, []);

  const enterDetails = useCallback(() => {
    if (!optionsRef.current.isMobile()) return;
    const layer = layerFromState(window.history.state);
    if (layer === "details") {
      window.history.replaceState(stateWithLayer("details"), "", currentUrl());
      return;
    }
    if (layer !== "thread") {
      window.history.pushState(stateWithLayer("thread"), "", currentUrl());
    }
    window.history.pushState(stateWithLayer("details"), "", currentUrl());
  }, []);

  const leaveDetails = useCallback(() => {
    const current = optionsRef.current;
    if (!current.isMobile()) {
      current.closeDetails();
      return;
    }
    if (layerFromState(window.history.state) === "details") {
      window.history.back();
    } else {
      current.closeDetails();
    }
  }, []);

  const leaveThread = useCallback(() => {
    const current = optionsRef.current;
    if (!current.isMobile()) {
      current.closeThread();
      return;
    }
    if (layerFromState(window.history.state) === "thread") {
      window.history.back();
    } else {
      current.closeThread();
    }
  }, []);

  useEffect(() => {
    function handlePopState(event: PopStateEvent) {
      const current = optionsRef.current;
      if (!current.isMobile()) return;
      const nextLayer = layerFromState(event.state);
      if (current.detailsOpen && nextLayer !== "details") {
        current.closeDetails();
        return;
      }
      if (current.threadOpen && nextLayer !== "thread" && nextLayer !== "details") {
        current.closeThread();
      }
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (
      !options.threadOpen &&
      options.isMobile() &&
      layerFromState(window.history.state) !== null
    ) {
      window.history.replaceState(stateWithoutLayer(), "", currentUrl());
    }
  }, [options.isMobile, options.threadOpen]);

  return { enterThread, switchThread, enterDetails, leaveThread, leaveDetails };
}
