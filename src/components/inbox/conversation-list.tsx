"use client";

import { format, isToday, isYesterday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Pin } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { ConversationListItem } from "@/modules/conversations/types";

import { ContactTagChip } from "./contact-tag-chip";
import { ContactTypeChip } from "./contact-type-chip";
import { richMessagePreview } from "./message-rich-content";

export { richMessagePreview } from "./message-rich-content";

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
  onSetPinned?: (id: string, pinned: boolean) => void;
  pinPendingIds?: Set<string>;
  pinError?: string | null;
};

type LatestMessageType = NonNullable<ConversationListItem["latestMessage"]>["type"];
const EMPTY_PIN_PENDING_IDS = new Set<string>();

const previewMediaNames: Partial<Record<LatestMessageType, string>> = {
  IMAGE: "imagem",
  AUDIO: "áudio",
  VIDEO: "vídeo",
  DOCUMENT: "documento",
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
  if (item.latestMessage.revokedAt) return "Mensagem apagada";
  const mediaName = previewMediaNames[item.latestMessage.type];
  if (mediaName && item.latestMessage.mediaState?.status === "PENDING") return `Baixando ${mediaName}`;
  if (mediaName && item.latestMessage.mediaState?.status === "FAILED") return `${mediaName[0].toUpperCase()}${mediaName.slice(1)} indisponível`;
  const richPreview = richMessagePreview(item.latestMessage);
  if (richPreview) return richPreview;
  if (item.latestMessage.body) return item.latestMessage.body;
  const fallbackPreviews: Partial<Record<LatestMessageType, string>> = {
    IMAGE: "Imagem",
    AUDIO: "Áudio",
    VIDEO: "Vídeo",
    DOCUMENT: "Documento",
    UNSUPPORTED: "Mensagem não compatível",
    TEXT: "Mensagem",
  };
  return fallbackPreviews[item.latestMessage.type] ?? "Mensagem não compatível";
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
  onSetPinned,
  pinPendingIds = EMPTY_PIN_PENDING_IDS,
  pinError,
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
      {pinError ? (
        <div className="border-b border-[var(--border)] bg-[var(--warning)] px-4 py-2 text-sm text-[var(--text)]" role="alert">
          {pinError}
        </div>
      ) : null}
      <ul aria-label="Conversas recentes" className="divide-y divide-[var(--border)]">
      {items.map((item) => {
        const selected = item.id === selectedId;
        const profilePictureUrl = (
          item.contact as typeof item.contact & { profilePictureUrl?: string | null }
        ).profilePictureUrl;
        return (
          <li className="conversation-list-item group relative" key={item.id}>
            <button
              aria-current={selected ? "true" : undefined}
              aria-label={`Abrir conversa com ${item.contact.name}`}
              className={cn(
                "min-h-11 w-full py-3 pl-4 pr-16 text-left outline-none transition-colors hover:bg-[var(--canvas)] focus-visible:relative focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]",
                selected && "bg-[var(--selected)]",
              )}
              data-conversation-id={item.id}
              onClick={() => onSelect(item.id)}
              ref={(element) => onButtonRef?.(item.id, element)}
              type="button"
            >
              <span className="flex min-w-0 items-start gap-3">
                <Avatar>
                  {profilePictureUrl ? <AvatarImage alt="" src={profilePictureUrl} /> : null}
                  <AvatarFallback>{initials(item.contact.name)}</AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-semibold text-[var(--text)]">{item.contact.name}</span>
                    <span className="flex shrink-0 items-center gap-1.5 text-xs tabular-nums text-[var(--muted)]">
                      {item.pinnedAt ? (
                        <span aria-label="Conversa fixada" role="img" title="Conversa fixada">
                          <Pin aria-hidden="true" className="size-3.5 fill-current" />
                        </span>
                      ) : null}
                      {conversationTime(item.lastMessageAt)}
                    </span>
                  </span>
                  <span className="mt-1 flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm text-[var(--muted)]">{preview(item)}</span>
                    {item.unreadCount > 0 ? <Badge aria-label={`${item.unreadCount} ${item.unreadCount === 1 ? "mensagem não lida" : "mensagens não lidas"}`}>{item.unreadCount}</Badge> : null}
                    {item.manuallyUnread ? <span aria-label="Conversa marcada como não lida" className="size-2 shrink-0 rounded-full bg-[var(--accent)]" role="img" title="Conversa marcada como não lida" /> : null}
                  </span>
                  {item.awaitingResponseSince ? <span className="mt-1 block text-xs font-medium text-[var(--text)]">Aguardando resposta</span> : null}
                  <span className="mt-1 block truncate text-xs text-[var(--muted)]">{item.responsible?.name ?? "Sem responsável"}</span>
                  {item.contact.type ? (
                    <span aria-label={`Tipo de contato de ${item.contact.name}`} className="mt-1.5 flex min-w-0">
                      <ContactTypeChip
                        color={item.contact.type.color}
                        compact
                        name={item.contact.type.name}
                      />
                    </span>
                  ) : null}
                  {item.contact.tags.length > 0 ? (
                    <span aria-label={`Etiquetas de ${item.contact.name}`} className="mt-1.5 flex min-w-0 items-center gap-1">
                      {item.contact.tags.slice(0, 2).map((tag) => (
                        <ContactTagChip color={tag.color} compact key={tag.id} name={tag.name} />
                      ))}
                      {item.contact.tags.length > 2 ? (
                        <span
                          aria-label={`Mais ${item.contact.tags.length - 2} etiquetas`}
                          className="shrink-0 rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-[var(--muted)]"
                        >
                          +{item.contact.tags.length - 2}
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                </span>
              </span>
            </button>
            {onSetPinned ? (
              <Button
                aria-label={`${item.pinnedAt ? "Desfixar" : "Fixar"} conversa de ${item.contact.name}`}
                aria-pressed={Boolean(item.pinnedAt)}
                className={cn(
                  "absolute right-1.5 top-1.5 z-20 text-[var(--muted)] sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100",
                  item.pinnedAt && "text-[var(--accent)] sm:opacity-100",
                )}
                disabled={pinPendingIds.has(item.id)}
                onClick={() => onSetPinned(item.id, !item.pinnedAt)}
                size="icon"
                title={item.pinnedAt ? "Desfixar conversa" : "Fixar conversa"}
                variant="ghost"
              >
                <Pin aria-hidden="true" className={cn("size-4", item.pinnedAt && "fill-current")} />
              </Button>
            ) : null}
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
