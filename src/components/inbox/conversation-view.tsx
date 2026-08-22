"use client";

import { ArrowLeft, CircleDot, Info, LoaderCircle } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { InboxConversation, InboxMessage } from "@/hooks/use-inbox";

import { MessageBubble } from "./message-bubble";
import { MessageComposer } from "./message-composer";

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function lastConfirmedMessageId(messages: InboxMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (!messages[index].id.startsWith("optimistic:")) return messages[index].id;
  }
  return null;
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

function ConversationHeader({
  conversation,
  detailsTriggerRef,
  markUnreadError,
  markUnreadPending,
  onBack,
  onMarkUnread,
  onOpenDetails,
}: {
  conversation: InboxConversation | null;
  detailsTriggerRef?: RefObject<HTMLButtonElement | null>;
  markUnreadError?: string | null;
  markUnreadPending?: boolean;
  onBack: () => void;
  onMarkUnread?: (conversationId: string) => Promise<unknown>;
  onOpenDetails: () => void;
}) {
  async function handleMarkUnread(action: HTMLButtonElement) {
    if (!conversation || !onMarkUnread) return;
    const conversationId = conversation.id;
    await onMarkUnread(conversationId);
    if (action.isConnected && action.dataset.conversationId === conversationId) action.focus();
  }

  const profilePictureUrl = conversation
    ? (
        conversation.contact as typeof conversation.contact & {
          profilePictureUrl?: string | null;
        }
      ).profilePictureUrl
    : null;

  return (
    <header className="flex min-h-16 shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--panel)] px-3">
      <Button aria-label="Voltar para conversas" className="mobile-back" onClick={onBack} size="icon" variant="ghost"><ArrowLeft aria-hidden="true" className="size-5" /></Button>
      {conversation ? (
        <>
          <Avatar>
            {profilePictureUrl ? <AvatarImage alt="" src={profilePictureUrl} /> : null}
            <AvatarFallback>{initials(conversation.contact.name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1"><h2 className="truncate font-bold text-[var(--text)]" data-thread-heading tabIndex={-1}>{conversation.contact.name}</h2><p className="truncate text-xs text-[var(--muted)]">{conversation.contact.phone}</p></div>
        </>
      ) : <h2 className="min-w-0 flex-1 font-bold text-[var(--text)]" data-thread-heading tabIndex={-1}>Conversa</h2>}
      <div className="flex shrink-0 flex-col items-end gap-1">
        <Button
          aria-busy={markUnreadPending || undefined}
          aria-label="Marcar como não lida"
          className="w-11 px-0 sm:w-auto sm:px-3"
          data-conversation-id={conversation?.id}
          disabled={!conversation || !onMarkUnread || markUnreadPending}
          onClick={(event) => void handleMarkUnread(event.currentTarget)}
          variant="secondary"
        >
          {markUnreadPending ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> : <CircleDot aria-hidden="true" className="size-4" />}
          <span className="hidden sm:inline">{markUnreadPending ? "Marcando…" : "Marcar como não lida"}</span>
        </Button>
        {markUnreadError ? <p className="max-w-40 text-right text-xs text-[var(--danger)]" role="alert">{markUnreadError}</p> : null}
      </div>
      <Button asChild aria-label="Abrir dados do cliente" className="details-trigger" disabled={!conversation} onClick={onOpenDetails} size="icon" variant="ghost">
        <button ref={detailsTriggerRef} type="button"><Info aria-hidden="true" className="size-5" /></button>
      </Button>
    </header>
  );
}

export function ConversationView({
  conversation,
  detailsTriggerRef,
  loading,
  error,
  onBack,
  markUnreadError = null,
  markUnreadPending = false,
  onMarkUnread,
  onOpenDetails,
  onRetryLoad,
  onVisibleMessage,
  onSendText,
  onSendMedia,
  onSendRecording,
  onRetryMessage,
  onReactMessage,
  onRetryReaction,
  reactionStateFor,
}: {
  conversation: InboxConversation | null;
  detailsTriggerRef?: RefObject<HTMLButtonElement | null>;
  loading: boolean;
  error: string | null;
  onBack: () => void;
  markUnreadError?: string | null;
  markUnreadPending?: boolean;
  onMarkUnread?: (conversationId: string) => Promise<unknown>;
  onOpenDetails: () => void;
  onRetryLoad: () => void;
  onVisibleMessage: (messageId: string) => void;
  onSendText: (body: string) => Promise<unknown>;
  onSendMedia: (file: File, caption: string) => Promise<unknown>;
  onSendRecording: (file: File, clientRequestId: string) => Promise<unknown>;
  onRetryMessage: (id: string) => void;
  onReactMessage?: (messageId: string, emoji: string) => unknown;
  onRetryReaction?: (messageId: string, reactionId: string) => unknown;
  reactionStateFor?: (messageId: string) => { pending: boolean; error: string | null };
}) {
  const historyRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const previousConversationId = useRef<string | null>(null);
  const previousMessageCount = useRef(0);
  const visibleMessageCallback = useRef(onVisibleMessage);
  const latestMessageId = conversation ? lastConfirmedMessageId(conversation.messages) : null;
  const latestMessageIdRef = useRef(latestMessageId);
  const reportedMessageId = useRef<string | null>(null);

  visibleMessageCallback.current = onVisibleMessage;
  latestMessageIdRef.current = latestMessageId;

  useEffect(() => {
    const history = historyRef.current;
    if (!history) return;
    const onScroll = () => {
      nearBottomRef.current = history.scrollHeight - history.scrollTop - history.clientHeight < 120;
      const latestId = latestMessageIdRef.current;
      if (nearBottomRef.current && latestId && reportedMessageId.current !== latestId) {
        reportedMessageId.current = latestId;
        visibleMessageCallback.current(latestId);
      }
    };
    history.addEventListener("scroll", onScroll, { passive: true });
    return () => history.removeEventListener("scroll", onScroll);
  }, [conversation?.id]);

  useLayoutEffect(() => {
    if (!conversation) {
      previousConversationId.current = null;
      previousMessageCount.current = 0;
      nearBottomRef.current = true;
      reportedMessageId.current = null;
      latestMessageIdRef.current = null;
      return;
    }
    const history = historyRef.current;
    if (!history) return;
    const changedConversation = previousConversationId.current !== conversation.id;
    const appended = conversation.messages.length > previousMessageCount.current;
    if (changedConversation) reportedMessageId.current = null;
    if ((changedConversation || (appended && nearBottomRef.current)) && typeof history.scrollTo === "function") {
      history.scrollTo({
        top: history.scrollHeight,
        behavior: changedConversation || prefersReducedMotion() ? "auto" : "smooth",
      });
    }
    if ((changedConversation || (appended && nearBottomRef.current)) && latestMessageId && reportedMessageId.current !== latestMessageId) {
      reportedMessageId.current = latestMessageId;
      visibleMessageCallback.current(latestMessageId);
    }
    previousConversationId.current = conversation.id;
    previousMessageCount.current = conversation.messages.length;
  }, [conversation, latestMessageId]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ConversationHeader
        conversation={conversation}
        detailsTriggerRef={detailsTriggerRef}
        markUnreadError={markUnreadError}
        markUnreadPending={markUnreadPending}
        onBack={onBack}
        onMarkUnread={onMarkUnread}
        onOpenDetails={onOpenDetails}
      />

      {loading && !conversation ? <div className="flex flex-1 items-center justify-center"><Spinner label="Carregando histórico" /></div> : null}

      {error && !conversation ? (
        <div className="flex flex-1 items-center justify-center p-8 text-center" role="alert">
          <div>
            <p className="font-bold text-[var(--text)]">Não foi possível abrir a conversa</p>
            <p className="mt-1 text-sm text-[var(--muted)]">{error}</p>
            <Button className="mt-4" onClick={onRetryLoad} variant="secondary">Tentar novamente</Button>
          </div>
        </div>
      ) : null}

      {!loading && !error && !conversation ? (
        <div className="flex flex-1 items-center justify-center px-8 text-center">
          <div><p className="font-bold text-[var(--text)]">Abra uma conversa</p><p className="mt-1 text-sm text-[var(--muted)]">Selecione um cliente para acompanhar o histórico e responder.</p></div>
        </div>
      ) : null}

      {conversation && error ? <div className="flex min-h-11 items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--warning)] px-4 py-1 text-sm text-[var(--text)]" role="alert"><span>{error}</span><Button className="shrink-0 px-2" onClick={onRetryLoad} size="small" variant="ghost">Tentar novamente</Button></div> : null}
      {conversation ? <div
        aria-label={`Histórico com ${conversation.contact.name}`}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-[var(--canvas)] p-4"
        ref={historyRef}
        role="log"
      >
        {conversation.messages.length === 0 ? <p className="py-12 text-center text-sm text-[var(--muted)]">Ainda não há mensagens nesta conversa.</p> : null}
        {conversation.messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            onReact={onReactMessage}
            onRetry={onRetryMessage}
            onRetryReaction={onRetryReaction}
            reactionMutation={reactionStateFor?.(message.id)}
          />
        ))}
      </div> : null}
      {conversation ? (
        <MessageComposer
          conversationId={conversation.id}
          disabled={loading}
          onSendMedia={onSendMedia}
          onSendRecording={onSendRecording}
          onSendText={onSendText}
        />
      ) : null}
    </div>
  );
}
