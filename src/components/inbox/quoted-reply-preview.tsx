"use client";

import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  quotedReplyTypeLabel,
  type QuotedReplyDto,
} from "@/modules/messages/reply-context";

export type QuotedReplyPreviewProps = {
  reply: QuotedReplyDto;
  onNavigate?: (messageId: string) => void;
  onCancel?: () => void;
  compact?: boolean;
};

export function QuotedReplyPreview({
  reply,
  onNavigate,
  onCancel,
  compact = false,
}: QuotedReplyPreviewProps) {
  const typeLabel = reply.available ? quotedReplyTypeLabel(reply.type) : null;
  const content = reply.available ? (
    <>
      <span className="block truncate text-xs font-bold text-[var(--accent)]">
        {reply.author}
        <span className="font-medium text-[var(--muted)]"> · {typeLabel}</span>
      </span>
      <span className="mt-0.5 block line-clamp-2 break-words text-xs leading-4 text-[var(--muted)]">
        {reply.summary}
      </span>
    </>
  ) : (
    <span className="block text-xs leading-4 text-[var(--muted)]">
      Mensagem original indisponível
    </span>
  );
  const contentClass = cn(
    "min-w-0 flex-1 border-l-[3px] border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_6%,white)] text-left",
    compact ? "rounded-sm px-2 py-1.5" : "rounded-md px-3 py-2",
  );

  return (
    <div className={cn("flex min-w-0 items-stretch", compact ? "gap-1" : "gap-2")}>
      {reply.available && onNavigate ? (
        <button
          aria-label={`Ir para mensagem original — ${reply.author} · ${typeLabel}: ${reply.summary}`}
          className={cn(contentClass, "cursor-pointer outline-none hover:bg-[color-mix(in_srgb,var(--accent)_10%,white)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]")}
          onClick={() => onNavigate(reply.messageId)}
          type="button"
        >
          {content}
        </button>
      ) : (
        <div className={contentClass}>{content}</div>
      )}
      {onCancel ? (
        <Button
          aria-label="Cancelar resposta citada"
          className="min-h-11 min-w-11 shrink-0"
          onClick={onCancel}
          size="icon"
          type="button"
          variant="ghost"
        >
          <X aria-hidden="true" className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}
