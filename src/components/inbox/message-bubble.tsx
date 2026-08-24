"use client";

import { AlertCircle, Check, CheckCheck, Clock3 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { InboxMessage } from "@/hooks/use-inbox";
import { useMessageReplyGesture } from "@/hooks/use-message-reply-gesture";
import { cn } from "@/lib/utils";
import type { MessageDto } from "@/modules/conversations/types";

import { MessageMedia } from "./message-media";
import { MessageActions } from "./message-actions";
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
  const canRetry = message.status === "FAILED" && Boolean(message.clientRequestId);
  const time = timeFormatter.format(new Date(message.externalTimestamp));
  const canReply = message.canReply && Boolean(onReply);
  const gesture = useMessageReplyGesture(canReply, () => onReply?.(message));
  return (
    <article
      {...gesture.handlers}
      className={cn(
        "message-row group/message relative flex items-center gap-1 rounded-lg [touch-action:pan-y] outline-none transition-[transform,background-color,box-shadow] duration-300 motion-reduce:transition-none",
        outbound ? "justify-end" : "justify-start",
        isHighlighted && "bg-[color-mix(in_srgb,var(--search-mark)_45%,transparent)] shadow-[0_0_0_3px_var(--search-mark)]",
      )}
      data-highlighted={isHighlighted ? "true" : undefined}
      data-message-id={message.id}
      data-direction={message.direction.toLowerCase()}
      data-search-highlighted={isHighlighted ? "true" : undefined}
      ref={(element) => registerElement?.(message.id, element)}
      style={{ transform: gesture.offset ? `translateX(${gesture.offset}px)` : undefined }}
      tabIndex={-1}
    >
      <div
        className={cn("relative max-w-[min(78%,42rem)] overflow-hidden break-words border border-[var(--border)] px-3 py-2 text-sm shadow-[0_1px_1px_rgba(32,37,34,0.03)] max-[767px]:max-w-[min(86%,36rem)]", outbound ? "rounded-[14px_14px_4px_14px] bg-[var(--outbound)]" : "rounded-[14px_14px_14px_4px] bg-[var(--inbound)]")}
        data-message-bubble
      >
        {outbound ? <p className="mb-1 text-xs font-bold text-[var(--accent)]" data-reply-swipe-ignore="true">{message.sentBy?.name ?? "WhatsApp"}</p> : null}
        {message.replyTo ? (
          <div className="mb-2">
            <QuotedReplyPreview
              compact
              onNavigate={onNavigateReply}
              reply={message.replyTo}
            />
          </div>
        ) : null}
        <MessageMedia message={message} onOpenMedia={onOpenMedia} />
        <MessageRichContent message={message} />
        {message.body ? <p className={cn("whitespace-pre-wrap break-words text-[var(--text)]", message.type !== "TEXT" && "mt-2")} data-reply-swipe-ignore="true">{message.body}</p> : null}
        <div className={cn("mt-1 flex items-center justify-end gap-1 text-[11px] tabular-nums", message.status === "FAILED" ? "text-[var(--danger)]" : "text-[var(--muted)]")} data-reply-swipe-ignore="true">
          <time dateTime={message.externalTimestamp}>{time}</time>
          {outbound ? <StatusIcon status={message.status} /> : null}
          {outbound ? <span>{statusCopy[message.status]}</span> : null}
        </div>
        {message.status === "FAILED" ? (
          <div className="mt-2 border-t border-[color-mix(in_srgb,var(--danger)_22%,transparent)] pt-2" data-reply-swipe-ignore="true">
            <p className="text-xs text-[var(--danger)]">Não foi possível enviar esta mensagem.</p>
            {onRetry && canRetry ? <Button className="mt-1 px-0 text-[var(--danger)]" onClick={() => onRetry(message.id)} size="small" variant="ghost">Tentar enviar novamente</Button> : null}
          </div>
        ) : null}
        {onReact ? (
          <MessageReactions
            message={message}
            mutation={reactionMutation}
            onReact={onReact}
            onRetry={onRetryReaction}
            showTrigger={false}
          />
        ) : null}
      </div>
      <MessageActions message={message} onReact={onReact} onReply={canReply ? onReply : undefined} />
    </article>
  );
}
