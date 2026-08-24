"use client";

import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Minus,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";

import { Button } from "@/components/ui/button";

import type { MediaGalleryItem } from "./media-gallery";

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;

type Point = { x: number; y: number };

function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

function ImageViewer({ item }: { item: MediaGalleryItem }) {
  const [scale, setScale] = useState(MIN_ZOOM);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const pointers = useRef(new Map<number, Point>());
  const dragOrigin = useRef<Point | null>(null);
  const pinchOrigin = useRef<{ distance: number; scale: number } | null>(null);

  const reset = useCallback(() => {
    setScale(MIN_ZOOM);
    setOffset({ x: 0, y: 0 });
  }, []);

  const changeZoom = useCallback((next: number) => {
    const bounded = clampZoom(next);
    setScale(bounded);
    if (bounded === MIN_ZOOM) setOffset({ x: 0, y: 0 });
  }, []);

  function pointerDistance(points: Point[]) {
    return Math.hypot(points[0]!.x - points[1]!.x, points[0]!.y - points[1]!.y);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLImageElement>) {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const active = [...pointers.current.values()];
    if (active.length === 2) {
      pinchOrigin.current = { distance: pointerDistance(active), scale };
      dragOrigin.current = null;
    } else if (scale > MIN_ZOOM) {
      dragOrigin.current = { x: event.clientX - offset.x, y: event.clientY - offset.y };
    }
    if (scale > MIN_ZOOM || active.length > 1) event.stopPropagation();
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLImageElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const active = [...pointers.current.values()];
    if (active.length === 2 && pinchOrigin.current) {
      const distance = pointerDistance(active);
      changeZoom(pinchOrigin.current.scale * distance / Math.max(1, pinchOrigin.current.distance));
      event.stopPropagation();
      return;
    }
    if (scale > MIN_ZOOM && dragOrigin.current) {
      setOffset({ x: event.clientX - dragOrigin.current.x, y: event.clientY - dragOrigin.current.y });
      event.stopPropagation();
    }
  }

  function handlePointerEnd(event: ReactPointerEvent<HTMLImageElement>) {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinchOrigin.current = null;
    if (pointers.current.size === 0) dragOrigin.current = null;
    if (scale > MIN_ZOOM) event.stopPropagation();
  }

  function handleWheel(event: ReactWheelEvent<HTMLImageElement>) {
    event.preventDefault();
    changeZoom(scale + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
  }

  return (
    <div className="relative flex size-full min-h-0 items-center justify-center overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element -- Authenticated media must remain an untransformed browser request. */}
      <img
        alt={item.filename}
        className="max-h-full max-w-full select-none object-contain will-change-transform"
        draggable={false}
        onDoubleClick={() => changeZoom(scale === MIN_ZOOM ? 2 : MIN_ZOOM)}
        onPointerCancel={handlePointerEnd}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onWheel={handleWheel}
        src={item.source}
        style={{
          cursor: scale > MIN_ZOOM ? "grab" : "zoom-in",
          touchAction: "none",
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
        }}
      />
      <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/70 p-1 text-white shadow-lg">
        <Button aria-label="Reduzir" className="text-white hover:bg-white/15 hover:text-white" disabled={scale <= MIN_ZOOM} onClick={() => changeZoom(scale - ZOOM_STEP)} size="icon" variant="ghost"><Minus aria-hidden="true" className="size-4" /></Button>
        <span className="min-w-14 text-center text-xs font-semibold tabular-nums">{Math.round(scale * 100)}%</span>
        <Button aria-label="Ampliar" className="text-white hover:bg-white/15 hover:text-white" disabled={scale >= MAX_ZOOM} onClick={() => changeZoom(scale + ZOOM_STEP)} size="icon" variant="ghost"><Plus aria-hidden="true" className="size-4" /></Button>
        <Button aria-label="Redefinir zoom" className="text-white hover:bg-white/15 hover:text-white" disabled={scale === MIN_ZOOM && offset.x === 0 && offset.y === 0} onClick={reset} size="icon" variant="ghost"><RotateCcw aria-hidden="true" className="size-4" /></Button>
      </div>
    </div>
  );
}

function VideoViewer({ item }: { item: MediaGalleryItem }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = videoRef.current;
    return () => { if (video && !video.paused) video.pause(); };
  }, [item.messageId]);
  return <video aria-label={item.filename} className="max-h-full max-w-full" controls playsInline preload="metadata" ref={videoRef} src={item.source} />;
}

function PdfViewer({ item }: { item: MediaGalleryItem }) {
  return (
    <div className="flex size-full min-h-0 flex-col">
      <iframe className="min-h-0 flex-1 border-0 bg-white" src={item.source} title={`Visualização de ${item.filename}`} />
      <p className="shrink-0 bg-black/70 px-3 py-2 text-center text-xs text-white/80">
        Se o PDF não abrir, use “Abrir em nova aba” ou “Baixar”.
      </p>
    </div>
  );
}

export function MediaViewerDialog({
  items,
  activeMessageId,
  onActiveMessageChange,
  onClose,
  returnFocus,
}: {
  items: MediaGalleryItem[];
  activeMessageId: string | null;
  onActiveMessageChange: (messageId: string) => void;
  onClose: () => void;
  returnFocus?: HTMLElement | null;
}) {
  const activeIndex = items.findIndex((item) => item.messageId === activeMessageId);
  const item = activeIndex >= 0 ? items[activeIndex]! : null;
  const swipeStart = useRef<Point | null>(null);

  const navigate = useCallback((direction: -1 | 1) => {
    const next = activeIndex + direction;
    if (next < 0 || next >= items.length) return;
    onActiveMessageChange(items[next]!.messageId);
  }, [activeIndex, items, onActiveMessageChange]);

  useEffect(() => {
    if (!item) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        navigate(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        navigate(1);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [item, navigate]);

  if (!item) return null;

  function handleSwipeStart(event: ReactPointerEvent<HTMLDivElement>) {
    swipeStart.current = { x: event.clientX, y: event.clientY };
  }

  function handleSwipeEnd(event: ReactPointerEvent<HTMLDivElement>) {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start) return;
    completeSwipe({ x: event.clientX, y: event.clientY }, start);
  }

  function completeSwipe(end: Point, start: Point) {
    const deltaX = end.x - start.x;
    const deltaY = end.y - start.y;
    if (Math.abs(deltaX) < 50 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
    navigate(deltaX < 0 ? 1 : -1);
  }


  return (
    <DialogPrimitive.Root onOpenChange={(open) => { if (!open) onClose(); }} open>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[80] bg-black/90" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-[90] grid h-[100dvh] w-screen grid-rows-[auto_minmax(0,1fr)] bg-[#101413] text-white outline-none"
          onCloseAutoFocus={(event) => {
            if (!returnFocus?.isConnected) return;
            event.preventDefault();
            returnFocus.focus();
          }}
        >
          <header className="flex min-h-16 items-center gap-2 border-b border-white/10 px-[max(0.75rem,env(safe-area-inset-left))] py-2 pr-[max(0.75rem,env(safe-area-inset-right))] pt-[max(0.5rem,env(safe-area-inset-top))]">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="truncate text-sm font-semibold">{item.filename}</DialogPrimitive.Title>
              <p className="text-xs text-white/65">{activeIndex + 1} de {items.length}</p>
            </div>
            <Button asChild aria-label="Baixar" className="text-white hover:bg-white/10 hover:text-white" size="icon" variant="ghost"><a download href={item.downloadSource}><Download aria-hidden="true" className="size-5" /></a></Button>
            <Button asChild aria-label="Abrir em nova aba" className="text-white hover:bg-white/10 hover:text-white" size="icon" variant="ghost"><a href={item.source} rel="noreferrer" target="_blank"><ExternalLink aria-hidden="true" className="size-5" /></a></Button>
            <DialogPrimitive.Close asChild><Button aria-label="Fechar visualizador" className="text-white hover:bg-white/10 hover:text-white" size="icon" variant="ghost"><X aria-hidden="true" className="size-5" /></Button></DialogPrimitive.Close>
          </header>

          <div
            className="relative flex min-h-0 items-center justify-center overflow-hidden px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-16"
            data-testid="media-viewer-viewport"
            onPointerCancel={() => { swipeStart.current = null; }}
            onPointerDown={handleSwipeStart}
            onPointerUp={handleSwipeEnd}
          >
            <Button aria-label="Mídia anterior" className="absolute left-2 z-10 bg-black/50 text-white hover:bg-black/70 hover:text-white max-sm:bottom-3 max-sm:top-auto sm:top-1/2 sm:-translate-y-1/2" disabled={activeIndex === 0} onClick={() => navigate(-1)} size="icon" variant="ghost"><ChevronLeft aria-hidden="true" className="size-7" /></Button>
            <div className="flex size-full min-h-0 items-center justify-center" key={item.messageId}>
              {item.kind === "image" ? <ImageViewer item={item} /> : null}
              {item.kind === "video" ? <VideoViewer item={item} /> : null}
              {item.kind === "pdf" ? <PdfViewer item={item} /> : null}
            </div>
            <Button aria-label="Próxima mídia" className="absolute right-2 z-10 bg-black/50 text-white hover:bg-black/70 hover:text-white max-sm:bottom-3 max-sm:top-auto sm:top-1/2 sm:-translate-y-1/2" disabled={activeIndex === items.length - 1} onClick={() => navigate(1)} size="icon" variant="ghost"><ChevronRight aria-hidden="true" className="size-7" /></Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
