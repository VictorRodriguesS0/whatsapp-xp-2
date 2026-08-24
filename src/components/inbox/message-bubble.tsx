"use client";

import { AlertCircle, Check, CheckCheck, Clock3, Reply } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { InboxMessage } from "@/hooks/use-inbox";
import { useMessageReplyGesture } from "@/hooks/use-message-reply-gesture";
import { cn } from "@/lib/utils";
import type { MessageDto } from "@/modules/conversations/types";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { MessageMedia } from "./message-media";
import { MessageReactions } from "./message-reactions";
import { MessageRichContent } from "./message-rich-content";
import { QuotedReplyPreview } from "./quoted-reply-preview";

const statusCopy = {
  PENDING: "Enviando",
  SENT: "Enviada",
  DELIVERED: "Entregue",
  READ: "Lida",
  FAILED: "Falha ao enviar",
  RECEIVED: "Recebida",
} as const;

const timeFormatter = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
});

function StatusIcon({ status }: { status: MessageDto["status"] }) {
  if (status === "PENDING") return <Clock3 aria-hidden="true" className="size-3.5" />;
  if (status === "FAILED") return <AlertCircle aria-hidden="true" className="size-3.5" />;
  if (status === "DELIVERED" || status === "READ") return <CheckCheck aria-hidden="true" className="size-3.5" />;
  return <Check aria-hidden="true" className="size-3.5" />;
}

function isInteractiveTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest("a,button,input,textarea,select,audio,video,[role='button']"));
}

type MessageBubbleProps = {
  message: InboxMessage;
  highlighted?: boolean;
  searchHighlighted?: boolean;
  onReply?: (message: InboxMessage) => void;
  onNavigateReply?: (messageId: string) => void;
  onOpenMedia?: (messageId: string) => void;
  onRetry?: (id: string) => void;
  onReact?: (messageId: string, emoji: string) => unknown;
  onRetryReaction?: (messageId: string, reactionId: string) => unknown;
  reactionMutation?: { pending: boolean; error: string | null };
  registerElement?: (messageId: string, element: HTMLElement | null) => void;
};

export function MessageBubble({
  message,
  highlighted = false,
  searchHighlighted = false,
  onReply,
  onNavigateReply,
  onOpenMedia,
  onRetry,
  onReact,
  onRetryReaction,
  reactionMutation,
  registerElement,
}: MessageBubbleProps) {
  const isHighlighted = highlighted || searchHighlighted;
  const outbound = message.direction === "OUTBOUND";
  const revoked = Boolean(message.revokedAt);
  const canRetry = message.status === "FAILED" && Boolean(message.clientRequestId);
  const time = timeFormatter.format(new Date(message.externalTimestamp));
  const canReply = !revoked && message.canReply && Boolean(onReply);
  const gesture = useMessageReplyGesture(canReply, () => onReply?.(message));
  const [reactionOpen, setReactionOpen] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);

  function cancelLongPress() {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
    pointerStart.current = null;
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (revoked || !onReact || event.button > 0 || isInteractiveTarget(event.target)) return;
    pointerStart.current = { x: event.clientX, y: event.clientY };
    longPressTimer.current = setTimeout(() => {
      setReactionOpen(true);
      longPressTimer.current = null;
    }, 500);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const start = pointerStart.current;
    if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) <= 8) return;
    cancelLongPress();
  }

  useEffect(() => () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  }, []);

  const replyAction = canReply ? (
    <Button
      aria-label="Responder à mensagem"
      className="min-h-11 min-w-11 shrink-0 opacity-100 transition-opacity min-[720px]:opacity-0 min-[720px]:group-hover/message:opacity-100 min-[720px]:group-focus-within/message:opacity-100"
      onClick={() => onReply?.(message)}
      size="icon"
      type="button"
      variant="ghost"
    >
      <Reply aria-hidden="true" className="size-4" />
    </Button>
  ) : null;

  return (
    <article
      {...gesture.handlers}
      className={cn(
        "message-row group/message flex items-center gap-1 rounded-lg [touch-action:pan-y] outline-none transition-[transform,background-color,box-shadow] duration-300 motion-reduce:transition-none",
        outbound ? "justify-end" : "justify-start",
        isHighlighted && "bg-[color-mix(in_srgb,var(--search-mark)_45%,transparent)] shadow-[0_0_0_3px_var(--search-mark)]",
      )}
      data-highlighted={isHighlighted ? "true" : undefined}
      data-message-id={message.id}
      data-search-highlighted={isHighlighted ? "true" : undefined}
      ref={(element) => registerElement?.(message.id, element)}
      style={{ transform: gesture.offset ? `translateX(${gesture.offset}px)` : undefined }}
      tabIndex={-1}
    >
      {outbound ? replyAction : null}
      <div
        className={cn("group relative max-w-[min(78%,42rem)] rounded-lg border border-[var(--border)] px-3 py-2 text-sm shadow-[0_1px_1px_rgba(32,37,34,0.03)]", outbound ? "bg-[var(--outbound)]" : "bg-[var(--inbound)]")}
        data-message-bubble
        onPointerCancel={cancelLongPress}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={cancelLongPress}
      >
        {outbound ? <p className="mb-1 text-xs font-bold text-[var(--accent)]" data-reply-swipe-ignore="true">{message.sentBy?.name ?? "WhatsApp"}</p> : null}
        {!revoked && message.replyTo ? (
          <div className="mb-2">
            <QuotedReplyPreview
              compact
              onNavigate={onNavigateReply}
              reply={message.replyTo}
            />
          </div>
        ) : null}
        {revoked ? (
          <p className="italic text-[var(--muted)]" data-reply-swipe-ignore="true">
            Mensagem apagada
          </p>
        ) : (
          <>
            <MessageMedia message={message} onOpenMedia={onOpenMedia} />
            <MessageRichContent message={message} />
            {message.body ? <p className={cn("whitespace-pre-wrap break-words text-[var(--text)]", message.type !== "TEXT" && "mt-2")} data-reply-swipe-ignore="true">{message.body}</p> : null}
          </>
        )}
        <div className={cn("mt-1 flex items-center justify-end gap-1 text-[11px] tabular-nums", message.status === "FAILED" ? "text-[var(--danger)]" : "text-[var(--muted)]")} data-reply-swipe-ignore="true">
          {!revoked && message.editedAt ? <span>editada</span> : null}
          <time dateTime={message.externalTimestamp}>{time}</time>
          {outbound ? <StatusIcon status={message.status} /> : null}
          {outbound ? <span>{statusCopy[message.status]}</span> : null}
        </div>
        {!revoked && message.status === "FAILED" ? (
          <div className="mt-2 border-t border-[color-mix(in_srgb,var(--danger)_22%,transparent)] pt-2" data-reply-swipe-ignore="true">
            <p className="text-xs text-[var(--danger)]">Não foi possível enviar esta mensagem.</p>
            {onRetry && canRetry ? <Button className="mt-1 px-0 text-[var(--danger)]" onClick={() => onRetry(message.id)} size="small" variant="ghost">Tentar enviar novamente</Button> : null}
          </div>
        ) : null}
        {!revoked && onReact ? (
          <MessageReactions
            message={message}
            mutation={reactionMutation}
            onOpenChange={setReactionOpen}
            onReact={onReact}
            onRetry={onRetryReaction}
            open={reactionOpen}
          />
        ) : null}
      </div>
      {!outbound ? replyAction : null}
    </article>
  );
}
