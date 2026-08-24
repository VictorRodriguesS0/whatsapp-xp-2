"use client";

import { ArrowLeft, CircleDot, Info, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { InboxConversation, InboxMessage } from "@/hooks/use-inbox";
import { useServiceWindow } from "@/hooks/use-service-window";
import type { MessageSearchResultDto } from "@/modules/message-search/types";
import type { ServiceWindowDto } from "@/modules/messaging-policy/types";
import {
  quotedReplyPreview,
  type AvailableQuotedReplyDto,
} from "@/modules/messages/reply-context";

import { ConversationMessageSearch } from "./conversation-message-search";
import { galleryItems } from "./media-gallery";
import { MediaViewerDialog } from "./media-viewer-dialog";
import { MessageBubble } from "./message-bubble";
import { MessageComposer } from "./message-composer";
import { ServiceWindowBanner } from "./service-window-banner";

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

const messageUuidPattern = /^[0-9a-f-]{36}$/iu;
const MEDIA_HISTORY_KEY = "__xpMediaViewer";

function historyState(): Record<string, unknown> {
  return window.history.state && typeof window.history.state === "object"
    ? window.history.state as Record<string, unknown>
    : {};
}

function removeMediaHistoryMarker(conversationId: string) {
  const state = historyState();
  if (state[MEDIA_HISTORY_KEY] !== conversationId) return;
  const next = { ...state };
  delete next[MEDIA_HISTORY_KEY];
  window.history.replaceState(
    Object.keys(next).length > 0 ? next : null,
    "",
    window.location.href,
  );
}

function ConversationControls({
  conversationId,
  disabled,
  serviceWindow: authoritativeServiceWindow,
  replyTo,
  replyToMessageId,
  onCancelReply,
  onResumeConversation,
  resumePending,
  resumeError,
  onSendMedia,
  onSendRecording,
  onSendText,
}: {
  conversationId: string;
  disabled: boolean;
  serviceWindow: ServiceWindowDto;
  replyTo: AvailableQuotedReplyDto | null;
  replyToMessageId: string | null;
  onCancelReply?: () => void;
  onResumeConversation: () => Promise<boolean>;
  resumePending: boolean;
  resumeError: string | null;
  onSendText: (body: string, replyToMessageId?: string | null) => Promise<unknown>;
  onSendMedia: (file: File, caption: string, replyToMessageId?: string | null) => Promise<unknown>;
  onSendRecording: (file: File, clientRequestId: string, replyToMessageId?: string | null) => Promise<unknown>;
}) {
  const serviceWindow = useServiceWindow(authoritativeServiceWindow);

  useEffect(() => {
    if (serviceWindow.sendMode !== "FREE_FORM" && replyToMessageId) {
      onCancelReply?.();
    }
  }, [onCancelReply, replyToMessageId, serviceWindow.sendMode]);

  return (
    <>
      <ServiceWindowBanner
        error={resumeError}
        onResume={onResumeConversation}
        pending={resumePending}
        serviceWindow={serviceWindow}
      />
      {serviceWindow.sendMode === "FREE_FORM" ? (
        <MessageComposer
          conversationId={conversationId}
          disabled={disabled}
          onCancelReply={onCancelReply}
          onSendMedia={onSendMedia}
          onSendRecording={onSendRecording}
          onSendText={onSendText}
          replyTo={replyTo}
        />
      ) : null}
    </>
  );
}

function ConversationHeader({
  conversation,
  detailsTriggerRef,
  markUnreadError,
  markUnreadPending,
  onBack,
  onMarkUnread,
  onOpenDetails,
  onSearchTarget,
}: {
  conversation: InboxConversation | null;
  detailsTriggerRef?: RefObject<HTMLButtonElement | null>;
  markUnreadError?: string | null;
  markUnreadPending?: boolean;
  onBack: () => void;
  onMarkUnread?: (conversationId: string) => Promise<unknown>;
  onOpenDetails: () => void;
  onSearchTarget?: (result: MessageSearchResultDto) => void;
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
    <header className="flex min-h-16 shrink-0 flex-wrap items-center gap-3 border-b border-[var(--border)] bg-[var(--panel)] px-3">
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
      {conversation && onSearchTarget ? <ConversationMessageSearch conversationId={conversation.id} onTarget={onSearchTarget} /> : null}
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
  onResumeConversation,
  resumePending = false,
  resumeError = null,
  onRetryMessage,
  onReactMessage,
  onRetryReaction,
  reactionStateFor,
  searchTargetMessageId = null,
  onSearchTarget,
  onSearchTargetHandled,
  replyToMessageId = null,
  onCancelReply,
  onReplyToMessage,
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
  onSendText: (body: string, replyToMessageId?: string | null) => Promise<unknown>;
  onSendMedia: (file: File, caption: string, replyToMessageId?: string | null) => Promise<unknown>;
  onSendRecording: (file: File, clientRequestId: string, replyToMessageId?: string | null) => Promise<unknown>;
  onResumeConversation: () => Promise<boolean>;
  resumePending?: boolean;
  resumeError?: string | null;
  onRetryMessage: (id: string) => void;
  onReactMessage?: (messageId: string, emoji: string) => unknown;
  onRetryReaction?: (messageId: string, reactionId: string) => unknown;
  reactionStateFor?: (messageId: string) => { pending: boolean; error: string | null };
  searchTargetMessageId?: string | null;
  onSearchTarget?: (result: MessageSearchResultDto) => void;
  onSearchTargetHandled?: () => void;
  replyToMessageId?: string | null;
  onCancelReply?: () => void;
  onReplyToMessage?: (message: InboxMessage) => void;
}) {
  const historyRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const previousConversationId = useRef<string | null>(null);
  const previousMessageCount = useRef(0);
  const visibleMessageCallback = useRef(onVisibleMessage);
  const latestMessageId = conversation ? lastConfirmedMessageId(conversation.messages) : null;
  const latestMessageIdRef = useRef(latestMessageId);
  const reportedMessageId = useRef<string | null>(null);
  const messageElements = useRef(new Map<string, HTMLElement>());
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [activeMediaMessageId, setActiveMediaMessageId] = useState<string | null>(null);
  const activeMediaMessageIdRef = useRef(activeMediaMessageId);
  const mediaReturnFocus = useRef<HTMLElement | null>(null);
  const mediaItems = useMemo(
    () => galleryItems(conversation?.messages ?? []),
    [conversation?.messages],
  );
  const replyTarget = conversation?.messages.find(
    (item) => item.id === replyToMessageId && item.canReply,
  ) ?? null;
  const replyPreview = replyTarget
    ? quotedReplyPreview({
        id: replyTarget.id,
        direction: replyTarget.direction,
        type: replyTarget.type,
        body: replyTarget.body,
        content: replyTarget.content,
        sentBy: replyTarget.sentBy,
      })
    : null;

  visibleMessageCallback.current = onVisibleMessage;
  latestMessageIdRef.current = latestMessageId;
  activeMediaMessageIdRef.current = activeMediaMessageId;

  const focusMediaTrigger = useCallback(() => {
    const trigger = mediaReturnFocus.current;
    queueMicrotask(() => {
      if (trigger?.isConnected) trigger.focus();
    });
  }, []);

  const openMedia = useCallback((messageId: string) => {
    if (!conversation || !mediaItems.some((item) => item.messageId === messageId)) return;
    mediaReturnFocus.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    if (
      activeMediaMessageIdRef.current === null &&
      window.history.state?.[MEDIA_HISTORY_KEY] !== conversation.id
    ) {
      window.history.pushState(
        { ...historyState(), [MEDIA_HISTORY_KEY]: conversation.id },
        "",
        window.location.href,
      );
    }
    setActiveMediaMessageId(messageId);
  }, [conversation, mediaItems]);

  const closeMedia = useCallback(() => {
    if (activeMediaMessageIdRef.current === null) return;
    if (window.history.state?.[MEDIA_HISTORY_KEY] === conversation?.id) {
      window.history.back();
      return;
    }
    setActiveMediaMessageId(null);
    focusMediaTrigger();
  }, [conversation?.id, focusMediaTrigger]);

  useEffect(() => {
    const handlePopState = () => {
      if (activeMediaMessageIdRef.current === null) return;
      setActiveMediaMessageId(null);
      focusMediaTrigger();
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [focusMediaTrigger]);

  useEffect(() => {
    const conversationId = conversation?.id;
    return () => {
      if (conversationId) removeMediaHistoryMarker(conversationId);
    };
  }, [conversation?.id]);

  useEffect(() => {
    if (
      activeMediaMessageId !== null &&
      !mediaItems.some((item) => item.messageId === activeMediaMessageId)
    ) {
      if (window.history.state?.[MEDIA_HISTORY_KEY] === conversation?.id) {
        window.history.back();
      } else {
        setActiveMediaMessageId(null);
        focusMediaTrigger();
      }
    }
  }, [activeMediaMessageId, conversation?.id, focusMediaTrigger, mediaItems]);

  const registerMessageElement = useCallback((messageId: string, element: HTMLElement | null) => {
    if (element) messageElements.current.set(messageId, element);
    else messageElements.current.delete(messageId);
  }, []);

  const navigateToMessage = useCallback((messageId: string) => {
    const element = messageElements.current.get(messageId);
    if (!element) return;
    element.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "center",
    });
    element.focus({ preventScroll: true });
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    setHighlightedMessageId(messageId);
    highlightTimer.current = setTimeout(() => {
      highlightTimer.current = null;
      setHighlightedMessageId(null);
    }, 1_500);
  }, []);

  useEffect(() => {
    setHighlightedMessageId(null);
    if (highlightTimer.current) {
      clearTimeout(highlightTimer.current);
      highlightTimer.current = null;
    }
    return () => {
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
    };
  }, [conversation?.id]);

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

  useEffect(() => {
    if (!searchTargetMessageId || !messageUuidPattern.test(searchTargetMessageId)) return;
    const history = historyRef.current;
    if (!history) return;
    const target = [...history.querySelectorAll<HTMLElement>("[data-message-id]")]
      .find((element) => element.dataset.messageId === searchTargetMessageId);
    if (!target) return;
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    setHighlightedMessageId(searchTargetMessageId);
    target.scrollIntoView({
      block: "center",
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
    target.focus({ preventScroll: true });
    highlightTimer.current = setTimeout(() => {
      highlightTimer.current = null;
      setHighlightedMessageId(null);
      onSearchTargetHandled?.();
    }, 3_000);
    return () => {
      if (highlightTimer.current) {
        clearTimeout(highlightTimer.current);
        highlightTimer.current = null;
      }
    };
  }, [conversation?.messages, onSearchTargetHandled, searchTargetMessageId]);

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
        onSearchTarget={onSearchTarget}
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
            highlighted={highlightedMessageId === message.id}
            key={message.id}
            message={message}
            onNavigateReply={navigateToMessage}
            onOpenMedia={openMedia}
            onReact={onReactMessage}
            onReply={onReplyToMessage}
            onRetry={onRetryMessage}
            onRetryReaction={onRetryReaction}
            reactionMutation={reactionStateFor?.(message.id)}
            registerElement={registerMessageElement}
          />
        ))}
      </div> : null}
      {conversation ? (
        <ConversationControls
          conversationId={conversation.id}
          disabled={loading}
          key={conversation.id}
          onCancelReply={onCancelReply}
          onResumeConversation={onResumeConversation}
          onSendMedia={onSendMedia}
          onSendRecording={onSendRecording}
          onSendText={onSendText}
          replyTo={replyPreview}
          replyToMessageId={replyToMessageId}
          resumeError={resumeError}
          resumePending={resumePending}
          serviceWindow={conversation.serviceWindow}
        />
      ) : null}
      <MediaViewerDialog
        activeMessageId={activeMediaMessageId}
        items={mediaItems}
        onActiveMessageChange={setActiveMediaMessageId}
        onClose={closeMedia}
        returnFocus={mediaReturnFocus.current}
      />
    </div>
  );
}
