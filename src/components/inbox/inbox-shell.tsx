"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useInbox } from "@/hooks/use-inbox";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useMessageSearch } from "@/hooks/use-message-search";
import { useMobileInboxHistory } from "@/hooks/use-mobile-inbox-history";
import { useMobileVisualViewportHeight } from "@/hooks/use-mobile-visual-viewport-height";
import type { SessionUser } from "@/modules/auth/session";
import type { MetaHealthSummaryDto } from "@/modules/meta-health/types";
import type { MessageSearchResultDto } from "@/modules/message-search/types";

import { ConnectionBanner } from "./connection-banner";
import { ConversationSidebar } from "./conversation-sidebar";
import { ConversationList } from "./conversation-list";
import { ConversationView } from "./conversation-view";
import { CustomerPanel } from "./customer-panel";
import { MessageSearchResults } from "./message-search-results";

function isMobileViewport() {
  return typeof window !== "undefined" && window.matchMedia?.("(max-width: 767px)").matches;
}

function afterPaint(callback: () => void) {
  if (typeof window.requestAnimationFrame === "function") {
    const frame = window.requestAnimationFrame(callback);
    return () => window.cancelAnimationFrame(frame);
  }
  const timer = window.setTimeout(callback, 0);
  return () => window.clearTimeout(timer);
}

function hasOpenDismissibleOverlay() {
  return Boolean(document.querySelector(
    '[role="dialog"][data-state="open"], [role="listbox"][data-state="open"], [role="menu"][data-state="open"]',
  ));
}

export function InboxShell({
  initialUser,
  initialMetaHealthSummary,
}: {
  initialUser: SessionUser;
  initialMetaHealthSummary?: MetaHealthSummaryDto | null;
}) {
  const router = useRouter();
  const inbox = useInbox(initialUser);
  const [mobileView, setMobileView] = useState<"list" | "thread">("list");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [searchMode, setSearchMode] = useState<"conversations" | "messages">("conversations");
  const [searchTargetMessageId, setSearchTargetMessageId] = useState<string | null>(null);
  const globalMessageSearch = useMessageSearch({ scope: "global" });
  const [replyToMessageId, setReplyToMessageId] = useState<string | null>(null);
  const conversationButtons = useRef(new Map<string, HTMLButtonElement>());
  const detailsRestoreTarget = useRef<HTMLButtonElement>(null);
  const lastSelectedId = useRef<string | null>(null);
  const selectedIdRef = useRef<string | null>(inbox.selectedId);
  const detailsOpenRef = useRef(detailsOpen);
  const replyToMessageIdRef = useRef(replyToMessageId);
  const cancelScheduledFocus = useRef<(() => void) | null>(null);
  selectedIdRef.current = inbox.selectedId;
  detailsOpenRef.current = detailsOpen;
  replyToMessageIdRef.current = replyToMessageId;
  const selectedListItem = inbox.conversation?.id === inbox.selectedId
    ? inbox.conversation
    : inbox.conversations.find((item) => item.id === inbox.selectedId) ?? null;
  const customerPanelProps = {
    availableTags: inbox.contactTags,
    availableTypes: inbox.contactTypes,
    conversation: selectedListItem,
    currentUserId: initialUser.id,
    onRetryTags: () => void inbox.loadContactTags(),
    onRetryTypes: () => void inbox.loadContactTypes(),
    onSaveTags: inbox.replaceContactTags,
    onSetMessagingRestriction: inbox.setMessagingRestriction,
    onSetContactType: inbox.setContactType,
    onSetResponsible: (id: string | null) => void inbox.setResponsible(id),
    pending: inbox.responsiblePending,
    messagingRestrictionError: inbox.messagingRestrictionError,
    messagingRestrictionPending: inbox.messagingRestrictionPending,
    tagSaveError: inbox.contactTagSaveError,
    tagSavePending: inbox.contactTagSavePendingId === selectedListItem?.contact.id,
    tagsError: inbox.contactTagsError,
    tagsLoading: inbox.contactTagsLoading,
    typeSaveError: inbox.contactTypeSaveError,
    typeSavePending: inbox.contactTypeSavePendingId === selectedListItem?.contact.id,
    typesError: inbox.contactTypesError,
    typesLoading: inbox.contactTypesLoading,
    users: inbox.users,
  };
  const selectedId = inbox.selectedId;
  const closeConversation = inbox.closeConversation;
  const isMobile = useMediaQuery("(max-width: 767px)");
  const mobileViewportHeight = useMobileVisualViewportHeight(isMobile);

  const closeThreadLocally = useCallback(() => {
    const idToRestore = lastSelectedId.current ?? selectedId;
    setMobileView("list");
    setDetailsOpen(false);
    setSearchTargetMessageId(null);
    setReplyToMessageId(null);
    closeConversation();
    if (idToRestore) {
      cancelScheduledFocus.current?.();
      cancelScheduledFocus.current = afterPaint(() => conversationButtons.current.get(idToRestore)?.focus());
    }
  }, [closeConversation, selectedId]);

  const closeDetailsLocally = useCallback(() => setDetailsOpen(false), []);

  const mobileHistory = useMobileInboxHistory({
    isMobile,
    threadOpen: mobileView === "thread",
    detailsOpen,
    closeThread: closeThreadLocally,
    closeDetails: closeDetailsLocally,
  });

  function selectConversation(id: string, open = true) {
    lastSelectedId.current = id;
    setSearchTargetMessageId(null);
    setReplyToMessageId(null);
    if (isMobileViewport()) {
      if (mobileView === "thread") mobileHistory.switchThread();
      else mobileHistory.enterThread();
    }
    setMobileView("thread");
    if (open) void inbox.openConversation(id);
    if (isMobileViewport()) {
      cancelScheduledFocus.current?.();
      cancelScheduledFocus.current = afterPaint(() => document.querySelector<HTMLElement>("[data-thread-heading]")?.focus());
    }
  }

  function selectMessageResult(result: MessageSearchResultDto) {
    selectConversation(result.conversationId, false);
    void (async () => {
      await inbox.openConversation(result.conversationId);
      const context = await inbox.loadMessageContext(result.conversationId, result.messageId);
      if (context) setSearchTargetMessageId(result.messageId);
    })();
  }

  function selectMessageInOpenConversation(result: MessageSearchResultDto) {
    setSearchTargetMessageId(null);
    void (async () => {
      const context = await inbox.loadMessageContext(result.conversationId, result.messageId);
      if (context) setSearchTargetMessageId(result.messageId);
    })();
  }

  function openDetails(trigger: HTMLButtonElement | null) {
    detailsRestoreTarget.current = trigger;
    setDetailsOpen(true);
    mobileHistory.enterDetails();
  }

  const registerConversationButton = useCallback((id: string, element: HTMLButtonElement | null) => {
    if (element) conversationButtons.current.set(id, element);
    else conversationButtons.current.delete(id);
  }, []);

  useEffect(() => () => cancelScheduledFocus.current?.(), []);

  useEffect(() => {
    setReplyToMessageId(null);
  }, [inbox.selectedId]);

  useEffect(() => {
    if (!replyToMessageId) return;
    const target = inbox.conversation?.id === inbox.selectedId
      ? inbox.conversation.messages.find((message) => message.id === replyToMessageId)
      : null;
    if (!target?.canReply) setReplyToMessageId(null);
  }, [inbox.conversation, inbox.selectedId, replyToMessageId]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        event.key !== "Escape" ||
        event.repeat ||
        event.isComposing ||
        event.defaultPrevented ||
        isMobileViewport() ||
        !selectedIdRef.current ||
        detailsOpenRef.current
      ) return;
      if (hasOpenDismissibleOverlay()) return;
      if (replyToMessageIdRef.current) {
        event.preventDefault();
        setReplyToMessageId(null);
        return;
      }
      event.preventDefault();
      closeThreadLocally();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeThreadLocally]);

  async function logout() {
    try { await fetch("/api/auth/logout", { method: "POST" }); } catch { /* internal navigation remains available */ }
    try { await Promise.resolve(router.replace("/login")); } catch { /* navigation cancellation is non-fatal */ }
  }

  return (
    <main aria-label="Central de atendimento" className="h-dvh bg-[var(--canvas)] p-3 sm:p-4">
      <div
        className="inbox-frame mx-auto flex h-full max-w-[1600px] flex-col overflow-hidden border border-[var(--border)] bg-[var(--panel)] shadow-[0_8px_30px_rgba(32,37,34,0.06)]"
        style={isMobile ? { height: mobileViewportHeight } : undefined}
      >
        <ConnectionBanner connected={inbox.connected} />
        <div className="inbox-grid min-h-0 flex-1" data-mobile-view={mobileView} data-testid="inbox-shell">
          <ConversationSidebar
            aria-hidden={isMobile && mobileView === "thread" ? true : undefined}
            conversationList={<ConversationList
                error={inbox.listError}
                hasMore={Boolean(inbox.nextCursor)}
                items={inbox.conversations}
                loadMoreError={inbox.loadMoreError}
                loading={inbox.loadingList}
                loadingMore={inbox.loadingMore}
                onButtonRef={registerConversationButton}
                onLoadMore={() => void inbox.loadMore()}
                onRetry={inbox.refreshList}
                onSelect={selectConversation}
                onSetPinned={(id, pinned) => void inbox.setPinned(id, pinned)}
                pinError={inbox.pinError}
                pinPendingIds={inbox.pinPendingIds}
                search={inbox.search}
                selectedId={inbox.selectedId}
              />}
            conversationQuery={inbox.search}
            inert={isMobile && mobileView === "thread" || undefined}
            messageQuery={globalMessageSearch.query}
            messageSearchResults={<MessageSearchResults
                error={globalMessageSearch.error}
                hasMore={Boolean(globalMessageSearch.nextCursor)}
                items={globalMessageSearch.items}
                loading={globalMessageSearch.loading}
                loadingMore={globalMessageSearch.loadingMore}
                onLoadMore={() => void globalMessageSearch.loadMore()}
                onRetry={globalMessageSearch.retry}
                onSelect={selectMessageResult}
                query={globalMessageSearch.query}
              />}
            metaHealthSummary={initialMetaHealthSummary}
            onConversationQueryChange={inbox.setSearch}
            onLogout={() => void logout()}
            onMessageQueryChange={globalMessageSearch.setQuery}
            onSearchModeChange={setSearchMode}
            searchMode={searchMode}
            user={initialUser}
          />

          <section aria-hidden={isMobile && mobileView === "list" ? true : undefined} aria-label="Conversa ativa" className="thread-pane min-h-0 bg-[var(--panel)]" inert={isMobile && mobileView === "list" || undefined} role="region">
            <ConversationView
              conversation={inbox.conversation}
              error={inbox.conversationError}
              loading={inbox.loadingConversation}
              markUnreadError={inbox.markUnreadError}
              markUnreadPending={inbox.markUnreadPending}
              onBack={mobileHistory.leaveThread}
              onMarkUnread={inbox.markUnread}
              onOpenDetails={openDetails}
              onCancelReply={() => setReplyToMessageId(null)}
              onReplyToMessage={(message) => setReplyToMessageId(message.id)}
              onRetryLoad={inbox.refreshConversation}
              onRetryMessage={(id) => void inbox.retryMessage(id)}
              onReactMessage={(messageId, emoji) => inbox.reactToMessage(messageId, emoji)}
              onRetryReaction={(messageId, reactionId) => inbox.retryReaction(messageId, reactionId)}
              reactionStateFor={inbox.reactionStateFor}
              onResumeConversation={() => (
                inbox.selectedId && inbox.conversation?.id === inbox.selectedId
                  ? inbox.resumeConversation(inbox.selectedId)
                  : Promise.resolve(false)
              )}
              resumeError={inbox.resumeError}
              resumePending={inbox.resumePending}
              onSearchTarget={selectMessageInOpenConversation}
              onSearchTargetHandled={() => setSearchTargetMessageId(null)}
              onSendMedia={(file, caption, targetMessageId) => {
                if (!inbox.selectedId || inbox.conversation?.id !== inbox.selectedId) {
                  return Promise.resolve(null);
                }
                return targetMessageId
                  ? inbox.sendMedia(inbox.selectedId, file, caption, targetMessageId)
                  : inbox.sendMedia(inbox.selectedId, file, caption);
              }}
              onSendRecording={(file, clientRequestId, targetMessageId) => (
                inbox.selectedId && inbox.conversation?.id === inbox.selectedId
                  ? targetMessageId
                    ? inbox.sendRecording(inbox.selectedId, file, clientRequestId, targetMessageId)
                    : inbox.sendRecording(inbox.selectedId, file, clientRequestId)
                  : Promise.resolve(null)
              )}
              onSendText={(body, targetMessageId) => {
                if (!inbox.selectedId || inbox.conversation?.id !== inbox.selectedId) {
                  return Promise.resolve(null);
                }
                return targetMessageId
                  ? inbox.sendText(inbox.selectedId, body, targetMessageId)
                  : inbox.sendText(inbox.selectedId, body);
              }}
              onVisibleMessage={(messageId) => {
                if (inbox.selectedId && inbox.conversation?.id === inbox.selectedId) void inbox.markRead(inbox.selectedId, messageId);
              }}
              searchTargetMessageId={searchTargetMessageId}
              replyToMessageId={replyToMessageId}
            />
          </section>

          <aside aria-label="Dados do cliente" className="customer-pane min-h-0 overflow-y-auto border-l border-[var(--border)] bg-[var(--panel)]">
            <CustomerPanel {...customerPanelProps} />
          </aside>
        </div>
      </div>

      <Dialog
        onOpenChange={(open) => {
          if (open) openDetails(detailsRestoreTarget.current);
          else if (detailsOpenRef.current) mobileHistory.leaveDetails();
        }}
        open={detailsOpen}
      >
        <DialogContent
          className="customer-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            detailsRestoreTarget.current?.focus();
          }}
        >
          <DialogTitle className="pr-12 text-lg font-bold text-[var(--text)]">Dados do cliente</DialogTitle>
          <DialogDescription className="sr-only">Contato e responsável pela conversa selecionada.</DialogDescription>
          <CustomerPanel {...customerPanelProps} />
        </DialogContent>
      </Dialog>
    </main>
  );
}
