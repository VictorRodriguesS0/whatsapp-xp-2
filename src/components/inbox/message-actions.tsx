"use client";

import { MessageCircleReply, MoreHorizontal, Plus, SmilePlus } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { InboxMessage } from "@/hooks/use-inbox";
import { cn } from "@/lib/utils";

import { canReplyToMessage, isMessageExpired } from "./message-interaction-eligibility";

const LazyFullEmojiPicker = dynamic(
  () => import("./full-emoji-picker").then(({ FullEmojiPicker }) => FullEmojiPicker),
  { ssr: false },
);

const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;
const HISTORY_KEY = "__xpMessageActions";

function serializeHistoryState(state: unknown) {
  try {
    return JSON.stringify(state);
  } catch {
    return null;
  }
}

function canReactTo(message: InboxMessage) {
  return !message.id.startsWith("optimistic:")
    && !message.revokedAt
    && message.status !== "PENDING"
    && message.status !== "FAILED"
    && !isMessageExpired(message);
}

function QuickReactionPicker({ onSelect, onFullPicker }: { onSelect: (emoji: string) => void; onFullPicker: () => void }) {
  return (
    <div aria-label="Reações rápidas" className="flex items-center" role="toolbar">
      {QUICK_EMOJIS.map((emoji) => (
        <button aria-label={`Reagir com ${emoji}`} className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-2xl hover:bg-[var(--canvas)] focus-visible:ring-2 focus-visible:ring-[var(--focus)]" key={emoji} onClick={() => onSelect(emoji)} type="button">
          {emoji}
        </button>
      ))}
      <button aria-label="Escolher outro emoji" className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-[var(--muted)] hover:bg-[var(--canvas)] focus-visible:ring-2 focus-visible:ring-[var(--focus)]" onClick={onFullPicker} type="button">
        <Plus aria-hidden="true" className="size-5" />
      </button>
    </div>
  );
}

export function MessageActions({ message, onReply, onReact }: {
  message: InboxMessage;
  onReply?: (message: InboxMessage) => void;
  onReact?: (messageId: string, emoji: string) => unknown;
}) {
  const canReply = canReplyToMessage(message, onReply);
  const canReact = Boolean(onReact) && canReactTo(message);
  const mobileTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileOpenRef = useRef(false);
  const ownsHistoryLayerRef = useRef(false);
  const historyLayerStateRef = useRef<string | null>(null);
  const historyLayerUrlRef = useRef<string | null>(null);
  const popTriggeredClose = useRef(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobilePicker, setMobilePicker] = useState<"none" | "quick" | "full">("none");
  const [desktopPickerOpen, setDesktopPickerOpen] = useState(false);
  const [showDesktopFullPicker, setShowDesktopFullPicker] = useState(false);

  function hasCurrentHistoryLayer() {
    return ownsHistoryLayerRef.current
      && historyLayerStateRef.current !== null
      && historyLayerUrlRef.current === window.location.href
      && serializeHistoryState(window.history.state) === historyLayerStateRef.current;
  }

  useEffect(() => {
    mobileOpenRef.current = mobileOpen;
  }, [mobileOpen]);

  useEffect(() => () => {
    if (!mobileOpenRef.current || !hasCurrentHistoryLayer()) return;
    ownsHistoryLayerRef.current = false;
    window.history.back();
  }, []);

  useEffect(() => {
    if (!mobileOpen || !window.matchMedia?.("(max-width: 767px)").matches) return;
    const state = window.history.state && typeof window.history.state === "object"
      ? window.history.state as Record<string, unknown>
      : {};
    if (state[HISTORY_KEY] !== message.id) {
      const historyLayer = { ...state, [HISTORY_KEY]: message.id };
      window.history.pushState(historyLayer, "", window.location.href);
      ownsHistoryLayerRef.current = true;
      historyLayerStateRef.current = serializeHistoryState(historyLayer);
      historyLayerUrlRef.current = window.location.href;
    }
    const onPopState = () => {
      if (!hasCurrentHistoryLayer() && ownsHistoryLayerRef.current) {
        ownsHistoryLayerRef.current = false;
        popTriggeredClose.current = true;
        setMobilePicker("none");
        setMobileOpen(false);
        queueMicrotask(() => {
          popTriggeredClose.current = false;
          mobileTriggerRef.current?.focus();
        });
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [message.id, mobileOpen]);

  function handleMobileOpenChange(open: boolean) {
    if (!open && !popTriggeredClose.current && hasCurrentHistoryLayer()) {
      ownsHistoryLayerRef.current = false;
      window.history.back();
    }
    setMobileOpen(open);
    if (!open) setMobilePicker("none");
  }

  if (!canReply && !canReact) return null;

  function selectMobileEmoji(emoji: string) {
    void onReact?.(message.id, emoji);
    handleMobileOpenChange(false);
    queueMicrotask(() => mobileTriggerRef.current?.focus());
  }

  function selectDesktopEmoji(emoji: string) {
    void onReact?.(message.id, emoji);
    setShowDesktopFullPicker(false);
    setDesktopPickerOpen(false);
  }

  return (
    <>
      <div className="message-actions-desktop absolute top-1/2 z-10 -translate-y-1/2 items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-1 opacity-0 shadow-sm transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100 motion-reduce:transition-none" data-testid="desktop-message-actions">
        {canReply ? <button aria-label="Responder à mensagem" className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--text)] focus-visible:ring-2 focus-visible:ring-[var(--focus)]" onClick={() => onReply?.(message)} type="button"><MessageCircleReply aria-hidden="true" className="size-4" /></button> : null}
        {canReact ? (
          <Popover onOpenChange={setDesktopPickerOpen} open={desktopPickerOpen}>
            <PopoverTrigger asChild>
              <button aria-label="Reagir à mensagem" className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--text)] focus-visible:ring-2 focus-visible:ring-[var(--focus)]" type="button"><SmilePlus aria-hidden="true" className="size-4" /></button>
            </PopoverTrigger>
            <PopoverContent className={cn(showDesktopFullPicker && "rounded-xl p-0")} side="top">
              {showDesktopFullPicker ? <LazyFullEmojiPicker onSelect={selectDesktopEmoji} /> : <QuickReactionPicker onFullPicker={() => setShowDesktopFullPicker(true)} onSelect={selectDesktopEmoji} />}
            </PopoverContent>
          </Popover>
        ) : null}
      </div>

      <DropdownMenu onOpenChange={handleMobileOpenChange} open={mobileOpen}>
        <DropdownMenuTrigger asChild>
          <button aria-label="Ações da mensagem" className="message-actions-mobile flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--muted)] shadow-sm hover:text-[var(--text)] focus-visible:ring-2 focus-visible:ring-[var(--focus)]" ref={mobileTriggerRef} type="button">
            <MoreHorizontal aria-hidden="true" className="size-5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={message.direction === "OUTBOUND" ? "end" : "start"} onCloseAutoFocus={(event) => { event.preventDefault(); mobileTriggerRef.current?.focus(); }} side="top">
          {mobilePicker !== "none" ? (
            <div className={cn(mobilePicker === "full" ? "rounded-xl p-0" : "p-1")}>
              {mobilePicker === "full"
                ? <LazyFullEmojiPicker onSelect={selectMobileEmoji} />
                : canReact ? <QuickReactionPicker onFullPicker={() => setMobilePicker("full")} onSelect={selectMobileEmoji} /> : null}
            </div>
          ) : (
            <>
              {canReply ? <DropdownMenuItem onSelect={() => { onReply?.(message); queueMicrotask(() => mobileTriggerRef.current?.focus()); }}><MessageCircleReply aria-hidden="true" className="size-4" />Responder</DropdownMenuItem> : null}
              {canReact ? <DropdownMenuItem onSelect={(event) => { event.preventDefault(); setMobilePicker("quick"); }}><SmilePlus aria-hidden="true" className="size-4" />Reagir</DropdownMenuItem> : null}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
