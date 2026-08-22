"use client";

import { ArrowDown, SearchX } from "lucide-react";
import { Fragment } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { MessageSearchResultDto } from "@/modules/message-search/types";

const typeLabels: Record<string, string> = {
  TEXT: "Texto",
  IMAGE: "Imagem",
  VIDEO: "Vídeo",
  AUDIO: "Áudio",
  DOCUMENT: "Documento",
  STICKER: "Figurinha",
  LOCATION: "Localização",
  CONTACTS: "Contato",
  INTERACTIVE: "Interação",
  ORDER: "Pedido",
  SYSTEM: "Sistema",
  UNKNOWN: "Mensagem",
};

function resultMeta(result: MessageSearchResultDto): string {
  const direction = result.direction === "INBOUND" ? "Recebida" : "Enviada";
  return `${direction} · ${typeLabels[result.type] ?? "Mensagem"}`;
}

function resultDate(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function HighlightedSnippet({ text, query }: { text: string; query: string }) {
  const normalizedText = text.toLocaleLowerCase("pt-BR");
  const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
  if (!normalizedQuery) return text;

  const parts: Array<{ text: string; match: boolean }> = [];
  let cursor = 0;
  while (cursor < text.length) {
    const index = normalizedText.indexOf(normalizedQuery, cursor);
    if (index < 0) {
      parts.push({ text: text.slice(cursor), match: false });
      break;
    }
    if (index > cursor) parts.push({ text: text.slice(cursor, index), match: false });
    parts.push({ text: text.slice(index, index + normalizedQuery.length), match: true });
    cursor = index + normalizedQuery.length;
  }

  return parts.map((part, index) => (
    <Fragment key={`${index}:${part.text}`}>
      {part.match ? <mark className="rounded-sm bg-[var(--search-mark)] px-0.5 text-inherit">{part.text}</mark> : part.text}
    </Fragment>
  ));
}

export function MessageSearchResults({
  items,
  query,
  loading = false,
  loadingMore = false,
  error = null,
  hasMore = false,
  onSelect,
  onLoadMore,
  onRetry,
}: {
  items: MessageSearchResultDto[];
  query: string;
  loading?: boolean;
  loadingMore?: boolean;
  error?: string | null;
  hasMore?: boolean;
  onSelect: (result: MessageSearchResultDto) => void;
  onLoadMore?: () => void;
  onRetry?: () => void;
}) {
  if (loading && items.length === 0) {
    return <div className="flex min-h-40 items-center justify-center"><Spinner label="Pesquisando mensagens" /></div>;
  }

  if (error && items.length === 0) {
    return (
      <div className="px-5 py-10 text-center" role="alert">
        <p className="font-semibold text-[var(--text)]">Não foi possível pesquisar</p>
        <p className="mt-1 text-sm text-[var(--danger)]">{error}</p>
        {onRetry ? <Button className="mt-4" onClick={onRetry} size="small" variant="secondary">Tentar novamente</Button> : null}
      </div>
    );
  }

  if (query.trim().length >= 2 && items.length === 0) {
    return (
      <div className="px-5 py-12 text-center">
        <SearchX aria-hidden="true" className="mx-auto size-6 text-[var(--muted)]" />
        <p className="mt-3 font-semibold text-[var(--text)]">Nenhuma mensagem encontrada</p>
        <p className="mt-1 text-sm text-[var(--muted)]">Tente outra palavra ou número.</p>
      </div>
    );
  }

  return (
    <div aria-label="Resultados em mensagens" role="list">
      {items.map((item) => (
        <div key={item.messageId} role="listitem">
          <button
            aria-label={`${item.contact.name}. ${item.snippet}. ${resultMeta(item)}`}
            className="block min-h-20 w-full border-b border-[var(--border)] px-4 py-3 text-left transition-colors hover:bg-[var(--canvas)] focus-visible:bg-[var(--canvas)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]"
            onClick={() => onSelect(item)}
            type="button"
          >
            <span className="flex items-baseline justify-between gap-3">
              <span className="truncate font-semibold text-[var(--text)]">{item.contact.name}</span>
              <time className="shrink-0 text-[0.6875rem] text-[var(--muted)]" dateTime={item.externalTimestamp}>{resultDate(item.externalTimestamp)}</time>
            </span>
            <span className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-[var(--muted)]">
              <span className="truncate">{item.contact.phone}</span><span aria-hidden="true">·</span><span className="shrink-0">{resultMeta(item)}</span>
            </span>
            <span className="mt-1 line-clamp-2 block text-sm leading-5 text-[var(--text)]"><HighlightedSnippet query={query} text={item.snippet} /></span>
          </button>
        </div>
      ))}
      {hasMore ? (
        <div className="p-3">
          <Button className="w-full" disabled={loadingMore} onClick={onLoadMore} size="small" variant="ghost">
            <ArrowDown aria-hidden="true" className="size-4" />
            {loadingMore ? "Carregando…" : "Carregar mais resultados"}
          </Button>
        </div>
      ) : null}
      {error ? <p className="p-3 text-center text-xs text-[var(--danger)]" role="alert">{error}</p> : null}
    </div>
  );
}
