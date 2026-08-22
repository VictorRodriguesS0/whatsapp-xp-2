"use client";

import { AlertCircle, Check, CheckCheck, Clock3 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { InboxMessage } from "@/hooks/use-inbox";
import { cn } from "@/lib/utils";
import type { MessageDto } from "@/modules/conversations/types";

import { MessageMedia } from "./message-media";
import { MessageRichContent } from "./message-rich-content";

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

export function MessageBubble({ message, onRetry, searchHighlighted = false }: { message: InboxMessage; onRetry?: (id: string) => void; searchHighlighted?: boolean }) {
  const outbound = message.direction === "OUTBOUND";
  const canRetry = message.status === "FAILED" && Boolean(message.clientRequestId);
  const time = timeFormatter.format(new Date(message.externalTimestamp));
  return (
    <article
      className={cn(
        "message-row flex rounded-lg outline-none transition-[background-color,box-shadow] duration-300",
        outbound ? "justify-end" : "justify-start",
        searchHighlighted && "bg-[color-mix(in_srgb,var(--search-mark)_45%,transparent)] shadow-[0_0_0_3px_var(--search-mark)]",
      )}
      data-message-id={message.id}
      data-search-highlighted={searchHighlighted || undefined}
      tabIndex={-1}
    >
      <div className={cn("max-w-[min(78%,42rem)] rounded-lg border border-[var(--border)] px-3 py-2 text-sm shadow-[0_1px_1px_rgba(32,37,34,0.03)]", outbound ? "bg-[var(--outbound)]" : "bg-[var(--inbound)]")}>
        {outbound ? <p className="mb-1 text-xs font-bold text-[var(--accent)]">{message.sentBy?.name ?? "WhatsApp"}</p> : null}
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
    </article>
  );
}
