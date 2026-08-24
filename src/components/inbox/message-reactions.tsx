"use client";

import { Plus, SmilePlus } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { MessageDto } from "@/modules/conversations/types";
import { cn } from "@/lib/utils";

const LazyFullEmojiPicker = dynamic(
  () => import("./full-emoji-picker").then(({ FullEmojiPicker }) => FullEmojiPicker),
  { ssr: false },
);

const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;
const HISTORY_KEY = "__xpReactionPicker";

function badgeLabel(reaction: MessageDto["reactions"][number]) {
  if (reaction.reactor === "CONTACT") return `Cliente reagiu com ${reaction.emoji}`;
  return `XP reagiu com ${reaction.emoji}${reaction.sentBy ? `, enviado por ${reaction.sentBy.name}` : ""}`;
}

export function MessageReactions({
  message,
  mutation = { pending: false, error: null },
  onReact,
  onRetry,
  open: controlledOpen,
  onOpenChange,
}: {
  message: MessageDto;
  mutation?: { pending: boolean; error: string | null };
  onReact(messageId: string, emoji: string): unknown;
  onRetry?(messageId: string, reactionId: string): unknown;
  open?: boolean;
  onOpenChange?(open: boolean): void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [showFullPicker, setShowFullPicker] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popTriggeredClose = useRef(false);
  const open = controlledOpen ?? internalOpen;
  const reactions = message.reactions ?? [];
  const businessReaction = reactions.find(({ reactor }) => reactor === "BUSINESS");

  function setOpen(next: boolean) {
    if (!next) setShowFullPicker(false);
    if (controlledOpen === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  }

  useEffect(() => {
    if (!open || typeof window === "undefined" || !window.matchMedia?.("(max-width: 767px)").matches) return;
    const state = window.history.state && typeof window.history.state === "object"
      ? window.history.state as Record<string, unknown>
      : {};
    if (state[HISTORY_KEY] !== message.id) {
      window.history.pushState({ ...state, [HISTORY_KEY]: message.id }, "", window.location.href);
    }
    const onPopState = () => {
      popTriggeredClose.current = true;
      setOpen(false);
      queueMicrotask(() => { popTriggeredClose.current = false; });
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [message.id, open]);

  function handleOpenChange(next: boolean) {
    if (
      !next &&
      !popTriggeredClose.current &&
      typeof window !== "undefined" &&
      window.history.state?.[HISTORY_KEY] === message.id
    ) {
      window.history.back();
    }
    setOpen(next);
  }

  function selectEmoji(emoji: string) {
    void onReact(message.id, emoji);
    handleOpenChange(false);
  }

  const messageAgeMs = Date.now() - new Date(message.externalTimestamp).getTime();
  const canReact =
    !message.id.startsWith("optimistic:") &&
    !message.revokedAt &&
    message.status !== "PENDING" &&
    message.status !== "FAILED" &&
    messageAgeMs <= 30 * 24 * 60 * 60 * 1_000;

  return (
    <div className="relative">
      {reactions.length > 0 ? (
        <div aria-label="Reações da mensagem" className="-mb-3 mt-1 flex flex-wrap gap-1">
          {reactions.map((reaction) => (
            <button
              aria-label={badgeLabel(reaction)}
              className={cn(
                "flex min-h-7 items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--panel)] px-2 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
                reaction.status === "PENDING" && "opacity-65",
              )}
              disabled={mutation.pending || reaction.reactor !== "BUSINESS"}
              key={`${reaction.reactor}:${reaction.id}`}
              onClick={() => reaction.reactor === "BUSINESS" && selectEmoji(reaction.emoji)}
              type="button"
            >
              <span aria-hidden="true">{reaction.emoji}</span>
              <span className="text-[10px] font-semibold text-[var(--muted)]">{reaction.reactor === "CONTACT" ? "Cliente" : "XP"}</span>
            </button>
          ))}
        </div>
      ) : null}

      <Popover onOpenChange={handleOpenChange} open={open}>
        <PopoverTrigger asChild>
          <button
            aria-label="Reagir à mensagem"
            className="reaction-trigger absolute -top-10 right-0 flex size-11 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--panel)] text-[var(--muted)] opacity-0 shadow-sm outline-none transition-opacity hover:text-[var(--text)] focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--accent)] group-hover:opacity-100 motion-reduce:transition-none"
            disabled={!canReact || mutation.pending}
            ref={triggerRef}
            type="button"
          >
            <SmilePlus aria-hidden="true" className="size-5" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align={message.direction === "OUTBOUND" ? "end" : "start"}
          className={cn(showFullPicker && "rounded-xl p-0")}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            triggerRef.current?.focus();
          }}
          side="top"
        >
          {showFullPicker ? (
            <LazyFullEmojiPicker onSelect={selectEmoji} />
          ) : (
            <div aria-label="Reações rápidas" className="flex items-center" role="toolbar">
              {QUICK_EMOJIS.map((emoji) => {
                const removing = businessReaction?.emoji === emoji;
                return (
                  <button
                    aria-label={removing ? `Remover reação ${emoji}` : `Reagir com ${emoji}`}
                    className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-2xl outline-none transition-transform hover:bg-[var(--canvas)] hover:scale-110 focus-visible:bg-[var(--canvas)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] motion-reduce:transition-none"
                    key={emoji}
                    onClick={() => selectEmoji(emoji)}
                    type="button"
                  >
                    {emoji}
                  </button>
                );
              })}
              <button
                aria-label="Escolher outro emoji"
                className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-[var(--muted)] outline-none hover:bg-[var(--canvas)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                onClick={() => setShowFullPicker(true)}
                type="button"
              >
                <Plus aria-hidden="true" className="size-5" />
              </button>
            </div>
          )}
        </PopoverContent>
      </Popover>

      {mutation.pending ? <span className="sr-only" role="status">Enviando reação</span> : null}
      {mutation.error ? (
        <div className="mt-3 flex items-center gap-2 text-xs text-[var(--danger)]" role="alert">
          <span>{mutation.error}</span>
          {onRetry && businessReaction && (businessReaction.status === "FAILED" || businessReaction.status === "OUTCOME_UNKNOWN") ? (
            <button
              className="min-h-11 font-semibold underline underline-offset-2"
              onClick={() => void onRetry(message.id, businessReaction.id)}
              type="button"
            >
              Tentar novamente
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
