"use client";

import { format, isToday, isYesterday } from "date-fns";
import { ptBR } from "date-fns/locale";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { ConversationListItem } from "@/modules/conversations/types";

type ConversationListProps = {
  items: ConversationListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading?: boolean;
  error?: string | null;
  search?: string;
  onRetry?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  loadMoreError?: string | null;
  onLoadMore?: () => void;
  onButtonRef?: (id: string, element: HTMLButtonElement | null) => void;
};

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function conversationTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  if (isToday(date)) return format(date, "HH:mm");
  if (isYesterday(date)) return "Ontem";
  return format(date, "dd MMM", { locale: ptBR });
}

function preview(item: ConversationListItem) {
  if (!item.latestMessage) return "Conversa iniciada";
  if (item.latestMessage.body) return item.latestMessage.body;
  return {
    IMAGE: "Imagem",
    AUDIO: "Áudio",
    VIDEO: "Vídeo",
    DOCUMENT: "Documento",
    UNSUPPORTED: "Mensagem não compatível",
    TEXT: "Mensagem",
  }[item.latestMessage.type];
}

export function ConversationList({
  items,
  selectedId,
  onSelect,
  loading = false,
  error,
  search = "",
  onRetry,
  hasMore = false,
  loadingMore = false,
  loadMoreError,
  onLoadMore,
  onButtonRef,
}: ConversationListProps) {
  if (loading && items.length === 0) {
    return <div className="flex min-h-40 items-center justify-center p-6"><Spinner label="Carregando conversas" /></div>;
  }

  if (error && items.length === 0) {
    return (
      <div className="m-4 border-l-2 border-[var(--danger)] py-1 pl-4" role="alert">
        <p className="text-sm font-semibold text-[var(--text)]">Não foi possível carregar</p>
        <p className="mt-1 text-sm text-[var(--muted)]">{error}</p>
        {onRetry ? <Button className="mt-3" onClick={onRetry} size="small" variant="secondary">Tentar novamente</Button> : null}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="px-6 py-14 text-center">
        <p className="font-semibold text-[var(--text)]">{search ? "Nenhuma conversa encontrada" : "Nenhuma conversa por aqui"}</p>
        <p className="mt-1 text-sm text-[var(--muted)]">{search ? "Revise o nome ou telefone pesquisado." : "As novas mensagens aparecerão nesta lista."}</p>
      </div>
    );
  }

  return (
    <>
      {error ? (
        <div className="flex min-h-11 items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--warning)] px-4 py-1 text-sm" role="alert">
          <span>{error}</span>
          {onRetry ? <Button className="px-2" onClick={onRetry} size="small" variant="ghost">Tentar novamente</Button> : null}
        </div>
      ) : null}
      <ul aria-label="Conversas recentes" className="divide-y divide-[var(--border)]">
      {items.map((item) => {
        const selected = item.id === selectedId;
        return (
          <li className="conversation-list-item" key={item.id}>
            <button
              aria-current={selected ? "true" : undefined}
              className={cn(
                "min-h-11 w-full px-4 py-3 text-left outline-none transition-colors hover:bg-[var(--canvas)] focus-visible:relative focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]",
                selected && "bg-[var(--selected)]",
              )}
              data-conversation-id={item.id}
              onClick={() => onSelect(item.id)}
              ref={(element) => onButtonRef?.(item.id, element)}
              type="button"
            >
              <span className="flex min-w-0 items-start gap-3">
                <Avatar>
                  {item.contact.profilePictureUrl ? <AvatarImage alt="" src={item.contact.profilePictureUrl} /> : null}
                  <AvatarFallback>{initials(item.contact.name)}</AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-semibold text-[var(--text)]">{item.contact.name}</span>
                    <span className="shrink-0 text-xs tabular-nums text-[var(--muted)]">{conversationTime(item.lastMessageAt)}</span>
                  </span>
                  <span className="mt-1 flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm text-[var(--muted)]">{preview(item)}</span>
                    {item.unreadCount > 0 ? <Badge aria-label={`${item.unreadCount} ${item.unreadCount === 1 ? "mensagem não lida" : "mensagens não lidas"}`}>{item.unreadCount}</Badge> : null}
                    {item.manuallyUnread ? <span aria-label="Conversa marcada como não lida" className="size-2 shrink-0 rounded-full bg-[var(--accent)]" role="img" title="Conversa marcada como não lida" /> : null}
                  </span>
                  {item.awaitingResponseSince ? <span className="mt-1 block text-xs font-medium text-[var(--text)]">Aguardando resposta</span> : null}
                  <span className="mt-1 block truncate text-xs text-[var(--muted)]">{item.responsible?.name ?? "Sem responsável"}</span>
                </span>
              </span>
            </button>
          </li>
        );
      })}
      </ul>
      {hasMore || loadingMore || loadMoreError ? (
        <div className="border-t border-[var(--border)] px-4 py-3 text-center">
          {loadMoreError ? <p className="mb-2 text-sm text-[var(--danger)]" role="alert">{loadMoreError}</p> : null}
          <Button
            aria-label={loadingMore ? "Carregando conversas anteriores" : loadMoreError ? "Tentar carregar novamente" : "Carregar conversas anteriores"}
            disabled={loadingMore}
            onClick={onLoadMore}
            variant="secondary"
          >
            {loadingMore ? <Spinner label="Carregando conversas anteriores" /> : loadMoreError ? "Tentar carregar novamente" : "Carregar conversas anteriores"}
          </Button>
        </div>
      ) : null}
    </>
  );
}
