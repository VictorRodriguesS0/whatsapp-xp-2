"use client";

import { ArrowLeft, CircleDot, Info, LoaderCircle, MoreHorizontal } from "lucide-react";
import { useRef, type RefObject } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { InboxConversation } from "@/hooks/use-inbox";
import type { MessageSearchResultDto } from "@/modules/message-search/types";

import { ConversationMessageSearch } from "./conversation-message-search";

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

type ThreadHeaderProps = {
  conversation: InboxConversation | null;
  detailsTriggerRef?: RefObject<HTMLButtonElement | null>;
  markUnreadError?: string | null;
  markUnreadPending?: boolean;
  onBack: () => void;
  onMarkUnread?: (conversationId: string) => Promise<unknown>;
  onOpenDetails: () => void;
  onSearchTarget?: (result: MessageSearchResultDto) => void;
};

export function ThreadHeader({
  conversation,
  detailsTriggerRef,
  markUnreadError,
  markUnreadPending,
  onBack,
  onMarkUnread,
  onOpenDetails,
  onSearchTarget,
}: ThreadHeaderProps) {
  const moreTriggerRef = useRef<HTMLButtonElement>(null);
  async function handleMarkUnread(action: HTMLElement) {
    if (!conversation || !onMarkUnread) return;
    const conversationId = conversation.id;
    await onMarkUnread(conversationId);
    if (action.isConnected && action.dataset.conversationId === conversationId) action.focus();
  }

  const profilePictureUrl = conversation
    ? (conversation.contact as typeof conversation.contact & { profilePictureUrl?: string | null }).profilePictureUrl
    : null;
  const controlsDisabled = !conversation || !onMarkUnread || markUnreadPending;

  return (
    <header className="flex min-h-16 shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--panel)] px-3">
      <Button aria-label="Voltar para conversas" className="mobile-back min-h-11 min-w-11" onClick={onBack} size="icon" variant="ghost">
        <ArrowLeft aria-hidden="true" className="size-5" />
      </Button>
      {conversation ? (
        <>
          <Avatar>
            {profilePictureUrl ? <AvatarImage alt="" src={profilePictureUrl} /> : null}
            <AvatarFallback>{initials(conversation.contact.name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1" data-testid="thread-heading-container">
            <h2 className="truncate font-bold text-[var(--text)]" data-thread-heading tabIndex={-1}>{conversation.contact.name}</h2>
            <p className="truncate text-xs text-[var(--muted)]">{conversation.contact.phone}</p>
          </div>
        </>
      ) : <h2 className="min-w-0 flex-1 font-bold text-[var(--text)]" data-thread-heading tabIndex={-1}>Conversa</h2>}

      {conversation && onSearchTarget ? <ConversationMessageSearch conversationId={conversation.id} onTarget={onSearchTarget} /> : null}

      <div className="thread-header-desktop-actions flex shrink-0 items-center gap-1">
        <Button
          aria-busy={markUnreadPending || undefined}
          aria-label="Marcar como não lida"
          className="min-h-11 min-w-11 px-0 md:w-auto md:px-3"
          data-conversation-id={conversation?.id}
          disabled={controlsDisabled}
          onClick={(event) => void handleMarkUnread(event.currentTarget)}
          variant="secondary"
        >
          {markUnreadPending ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> : <CircleDot aria-hidden="true" className="size-4" />}
          <span className="hidden md:inline">{markUnreadPending ? "Marcando…" : "Marcar como não lida"}</span>
        </Button>
        <Button asChild aria-label="Abrir dados do cliente" className="details-trigger min-h-11 min-w-11" disabled={!conversation} onClick={onOpenDetails} size="icon" variant="ghost">
          <button ref={detailsTriggerRef} type="button"><Info aria-hidden="true" className="size-5" /></button>
        </Button>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button aria-label="Mais opções" className="thread-header-more flex min-h-11 min-w-11 items-center justify-center rounded-xl text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--text)] focus-visible:ring-2 focus-visible:ring-[var(--focus)]" ref={moreTriggerRef} type="button">
            <MoreHorizontal aria-hidden="true" className="size-5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onCloseAutoFocus={(event) => {
          event.preventDefault();
          moreTriggerRef.current?.focus();
        }}>
          <DropdownMenuItem data-conversation-id={conversation?.id} disabled={controlsDisabled} onSelect={(event) => void handleMarkUnread(event.currentTarget as HTMLElement)}>
            <CircleDot aria-hidden="true" className="size-4" />
            Marcar como não lida
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!conversation} onSelect={onOpenDetails}>
            <Info aria-hidden="true" className="size-4" />
            Abrir dados do cliente
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {markUnreadError ? <p className="sr-only" role="alert">{markUnreadError}</p> : null}
    </header>
  );
}
