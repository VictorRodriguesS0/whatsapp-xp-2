"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
} from "react";

export const REPLY_SWIPE_THRESHOLD_PX = 56;
export const REPLY_SWIPE_VERTICAL_ABORT_PX = 12;
const REPLY_SWIPE_MAX_OFFSET_PX = 72;
const SWIPE_IGNORE_SELECTOR = [
  "button",
  "a",
  "input",
  "textarea",
  "select",
  "audio",
  "video",
  "p",
  "span",
  "blockquote",
  "code",
  "pre",
  '[role="button"]',
  '[data-reply-swipe-ignore="true"]',
].join(", ");

type TrackingPointer = {
  id: number;
  startX: number;
  startY: number;
  cancelled: boolean;
};

type ReplyGestureHandlers = Pick<
  HTMLAttributes<HTMLElement>,
  "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel"
>;

function releasePointer(event: ReactPointerEvent<HTMLElement>) {
  try {
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  } catch {
    // Pointer capture can already be released by the browser during cancellation.
  }
}

export function useMessageReplyGesture(
  enabled: boolean,
  onReply: () => void,
): { offset: number; handlers: ReplyGestureHandlers } {
  const [offset, setOffset] = useState(0);
  const offsetRef = useRef(0);
  const tracking = useRef<TrackingPointer | null>(null);
  const replyCallback = useRef(onReply);
  replyCallback.current = onReply;

  const reset = useCallback(() => {
    tracking.current = null;
    offsetRef.current = 0;
    setOffset(0);
  }, []);

  useEffect(() => {
    if (!enabled) reset();
  }, [enabled, reset]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (
      !enabled ||
      (event.pointerType !== "touch" && event.pointerType !== "pen") ||
      event.isPrimary === false ||
      event.button !== 0
    ) return;
    const target = event.target;
    if (target instanceof Element && target.closest(SWIPE_IGNORE_SELECTOR)) return;
    tracking.current = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      cancelled: false,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // The gesture still works when pointer capture is unavailable.
    }
  }, [enabled]);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const active = tracking.current;
    if (!active || active.id !== event.pointerId || active.cancelled) return;
    const deltaX = event.clientX - active.startX;
    const deltaY = event.clientY - active.startY;
    if (
      Math.abs(deltaY) >= REPLY_SWIPE_VERTICAL_ABORT_PX &&
      Math.abs(deltaY) > Math.abs(deltaX)
    ) {
      active.cancelled = true;
      offsetRef.current = 0;
      setOffset(0);
      releasePointer(event);
      return;
    }
    const nextOffset = Math.min(REPLY_SWIPE_MAX_OFFSET_PX, Math.max(0, deltaX));
    offsetRef.current = nextOffset;
    setOffset(nextOffset);
    if (nextOffset > 0) event.preventDefault();
  }, []);

  const finish = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const active = tracking.current;
    if (!active || active.id !== event.pointerId) return;
    const shouldReply = enabled && !active.cancelled && offsetRef.current >= REPLY_SWIPE_THRESHOLD_PX;
    releasePointer(event);
    reset();
    if (shouldReply) replyCallback.current();
  }, [enabled, reset]);

  const cancel = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const active = tracking.current;
    if (!active || active.id !== event.pointerId) return;
    releasePointer(event);
    reset();
  }, [reset]);

  const handlers = useMemo<ReplyGestureHandlers>(() => ({
    onPointerDown,
    onPointerMove,
    onPointerUp: finish,
    onPointerCancel: cancel,
  }), [cancel, finish, onPointerDown, onPointerMove]);

  return { offset, handlers };
}
