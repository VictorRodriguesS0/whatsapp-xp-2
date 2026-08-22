"use client";

import { AlertCircle, Check, CheckCheck, Clock3, Reply } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { InboxMessage } from "@/hooks/use-inbox";
import { useMessageReplyGesture } from "@/hooks/use-message-reply-gesture";
import { cn } from "@/lib/utils";
import type { MessageDto } from "@/modules/conversations/types";

import { MessageMedia } from "./message-media";
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
  onReply?: (message: InboxMessage) => void;
  onNavigateReply?: (messageId: string) => void;
  onRetry?: (id: string) => void;
  registerElement?: (messageId: string, element: HTMLElement | null) => void;
};

export function MessageBubble({
  message,
  highlighted = false,
  onReply,
  onNavigateReply,
  onRetry,
  registerElement,
}: MessageBubbleProps) {
  const outbound = message.direction === "OUTBOUND";
  const canRetry = message.status === "FAILED" && Boolean(message.clientRequestId);
  const time = timeFormatter.format(new Date(message.externalTimestamp));
  const canReply = message.canReply && Boolean(onReply);
  const gesture = useMessageReplyGesture(canReply, () => onReply?.(message));
  const replyAction = canReply ? (
    <Button
      aria-label="Responder à mensagem"
      className="min-h-11 min-w-11 shrink-0 opacity-100 transition-opacity sm:opacity-0 sm:group-hover/message:opacity-100 sm:group-focus-within/message:opacity-100"
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
        "message-row group/message flex items-center gap-1 [touch-action:pan-y] outline-none transition-[transform,background-color] duration-150 motion-reduce:transition-none",
        outbound ? "justify-end" : "justify-start",
        highlighted && "rounded-md bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]",
      )}
      data-highlighted={highlighted ? "true" : undefined}
      ref={(element) => registerElement?.(message.id, element)}
      style={{ transform: gesture.offset ? `translateX(${gesture.offset}px)` : undefined }}
      tabIndex={-1}
    >
      {outbound ? replyAction : null}
      <div className={cn("max-w-[min(78%,42rem)] rounded-lg border border-[var(--border)] px-3 py-2 text-sm shadow-[0_1px_1px_rgba(32,37,34,0.03)]", outbound ? "bg-[var(--outbound)]" : "bg-[var(--inbound)]")}>
        {outbound ? <p className="mb-1 text-xs font-bold text-[var(--accent)]">{message.sentBy?.name ?? "WhatsApp"}</p> : null}
        {message.replyTo ? (
          <div className="mb-2">
            <QuotedReplyPreview
              compact
              onNavigate={onNavigateReply}
              reply={message.replyTo}
            />
          </div>
        ) : null}
        <MessageMedia message={message} />
        <MessageRichContent message={message} />
        {message.body ? <p className={cn("whitespace-pre-wrap break-words text-[var(--text)]", message.type !== "TEXT" && "mt-2")}>{message.body}</p> : null}
        <div className={cn("mt-1 flex items-center justify-end gap-1 text-[11px] tabular-nums", message.status === "FAILED" ? "text-[var(--danger)]" : "text-[var(--muted)]")}>
          <time dateTime={message.externalTimestamp}>{time}</time>
          {outbound ? <StatusIcon status={message.status} /> : null}
          {outbound ? <span>{statusCopy[message.status]}</span> : null}
        </div>
        {message.status === "FAILED" ? (
          <div className="mt-2 border-t border-[color-mix(in_srgb,var(--danger)_22%,transparent)] pt-2">
            <p className="text-xs text-[var(--danger)]">Não foi possível enviar esta mensagem.</p>
            {onRetry && canRetry ? <Button className="mt-1 px-0 text-[var(--danger)]" onClick={() => onRetry(message.id)} size="small" variant="ghost">Tentar enviar novamente</Button> : null}
          </div>
        ) : null}
      </div>
      {!outbound ? replyAction : null}
    </article>
  );
}
