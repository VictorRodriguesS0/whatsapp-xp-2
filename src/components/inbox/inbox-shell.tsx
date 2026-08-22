"use client";

import { LogOut, MessageSquareText, Search, Settings, Tags } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useInbox } from "@/hooks/use-inbox";
import { useMessageSearch } from "@/hooks/use-message-search";
import { useMobileInboxHistory } from "@/hooks/use-mobile-inbox-history";
import type { SessionUser } from "@/modules/auth/session";
import type { MessageSearchResultDto } from "@/modules/message-search/types";

import { ConnectionBanner } from "./connection-banner";
import { ConversationList } from "./conversation-list";
import { ConversationView } from "./conversation-view";
import { CustomerPanel } from "./customer-panel";
import { MessageSearchResults } from "./message-search-results";

function isMobileViewport() {
  return typeof window !== "undefined" && window.matchMedia?.("(max-width: 719px)").matches;
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

export function InboxShell({ initialUser }: { initialUser: SessionUser }) {
  const router = useRouter();
  const inbox = useInbox(initialUser);
  const [mobileView, setMobileView] = useState<"list" | "thread">("list");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [searchMode, setSearchMode] = useState<"conversations" | "messages">("conversations");
  const [searchTargetMessageId, setSearchTargetMessageId] = useState<string | null>(null);
  const globalMessageSearch = useMessageSearch({ scope: "global" });
  const [replyToMessageId, setReplyToMessageId] = useState<string | null>(null);
  const conversationButtons = useRef(new Map<string, HTMLButtonElement>());
  const detailsTrigger = useRef<HTMLButtonElement>(null);
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
  const selectedId = inbox.selectedId;
  const closeConversation = inbox.closeConversation;

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
    isMobile: isMobileViewport,
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

  function openDetails() {
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
    <main aria-label="Central de atendimento" className="h-dvh min-h-[34rem] bg-[var(--canvas)] p-3 sm:p-4">
      <div className="inbox-frame mx-auto flex h-full max-w-[1600px] flex-col overflow-hidden border border-[var(--border)] bg-[var(--panel)] shadow-[0_8px_30px_rgba(32,37,34,0.06)]">
        <ConnectionBanner connected={inbox.connected} />
        <div className="inbox-grid min-h-0 flex-1" data-mobile-view={mobileView} data-testid="inbox-shell">
          <aside aria-label="Conversas" className="conversation-pane flex min-h-0 flex-col border-r border-[var(--border)] bg-[var(--panel)]" role="region">
            <header className="shrink-0 border-b border-[var(--border)] px-4 py-3">
              <div className="flex min-h-11 items-center justify-between gap-3">
                <div><p className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--accent)]">XP Eletrônicos</p><h1 className="text-lg font-bold tracking-tight text-[var(--text)]">Atendimento</h1></div>
                <div className="flex">
                  <Button asChild aria-label="Configurar respostas rápidas" size="icon" variant="ghost"><a href="/configuracoes/respostas-rapidas"><MessageSquareText aria-hidden="true" className="size-4" /></a></Button>
                  {initialUser.role === "ADMIN" ? (
                    <>
                      <Button asChild aria-label="Configurar classificações" size="icon" variant="ghost"><a href="/configuracoes/atendimento"><Tags aria-hidden="true" className="size-4" /></a></Button>
                      <Button asChild aria-label="Configurar usuários" size="icon" variant="ghost"><a href="/configuracoes/usuarios"><Settings aria-hidden="true" className="size-4" /></a></Button>
                    </>
                  ) : null}
                  <Button aria-label="Sair" onClick={() => void logout()} size="icon" variant="ghost"><LogOut aria-hidden="true" className="size-4" /></Button>
                </div>
              </div>
              <div aria-label="Tipo de busca" className="mt-3 grid grid-cols-2 rounded-md bg-[var(--canvas)] p-1" role="group">
                <button
                  aria-pressed={searchMode === "conversations"}
                  className="min-h-9 rounded px-3 text-xs font-semibold text-[var(--muted)] transition-colors aria-pressed:bg-[var(--panel)] aria-pressed:text-[var(--accent)] aria-pressed:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  onClick={() => setSearchMode("conversations")}
                  type="button"
                >Conversas</button>
                <button
                  aria-pressed={searchMode === "messages"}
                  className="min-h-9 rounded px-3 text-xs font-semibold text-[var(--muted)] transition-colors aria-pressed:bg-[var(--panel)] aria-pressed:text-[var(--accent)] aria-pressed:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  onClick={() => setSearchMode("messages")}
                  type="button"
                >Mensagens</button>
              </div>
              <label className="relative mt-2 block" htmlFor="conversation-search">
                <span className="sr-only">{searchMode === "messages" ? "Buscar nas mensagens" : "Buscar conversas"}</span>
                <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 size-4 text-[var(--muted)]" />
                <Input
                  aria-label={searchMode === "messages" ? "Buscar nas mensagens" : "Buscar conversas"}
                  className="pl-9"
                  id="conversation-search"
                  onChange={(event) => searchMode === "messages" ? globalMessageSearch.setQuery(event.target.value) : inbox.setSearch(event.target.value)}
                  placeholder={searchMode === "messages" ? "Buscar nas mensagens" : "Buscar por nome ou telefone"}
                  type="search"
                  value={searchMode === "messages" ? globalMessageSearch.query : inbox.search}
                />
              </label>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {searchMode === "conversations" ? <ConversationList
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
                search={inbox.search}
                selectedId={inbox.selectedId}
              /> : <MessageSearchResults
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
            </div>
          </aside>

          <section aria-label="Conversa ativa" className="thread-pane min-h-0 bg-[var(--panel)]">
            <ConversationView
              conversation={inbox.conversation}
              detailsTriggerRef={detailsTrigger}
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
            <CustomerPanel
              availableTags={inbox.contactTags}
              availableTypes={inbox.contactTypes}
              conversation={selectedListItem}
              currentUserId={initialUser.id}
              onRetryTags={() => void inbox.loadContactTags()}
              onRetryTypes={() => void inbox.loadContactTypes()}
              onSaveTags={inbox.replaceContactTags}
              onSetContactType={inbox.setContactType}
              onSetResponsible={(id) => void inbox.setResponsible(id)}
              pending={inbox.responsiblePending}
              tagSaveError={inbox.contactTagSaveError}
              tagSavePending={inbox.contactTagSavePendingId === selectedListItem?.contact.id}
              tagsError={inbox.contactTagsError}
              tagsLoading={inbox.contactTagsLoading}
              typeSaveError={inbox.contactTypeSaveError}
              typeSavePending={inbox.contactTypeSavePendingId === selectedListItem?.contact.id}
              typesError={inbox.contactTypesError}
              typesLoading={inbox.contactTypesLoading}
              users={inbox.users}
            />
          </aside>
        </div>
      </div>

      <Dialog
        onOpenChange={(open) => {
          if (open) openDetails();
          else if (detailsOpenRef.current) mobileHistory.leaveDetails();
        }}
        open={detailsOpen}
      >
        <DialogContent
          className="customer-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            detailsTrigger.current?.focus();
          }}
        >
          <DialogTitle className="pr-12 text-lg font-bold text-[var(--text)]">Dados do cliente</DialogTitle>
          <DialogDescription className="sr-only">Contato e responsável pela conversa selecionada.</DialogDescription>
          <CustomerPanel
            availableTags={inbox.contactTags}
            availableTypes={inbox.contactTypes}
            conversation={selectedListItem}
            currentUserId={initialUser.id}
            onRetryTags={() => void inbox.loadContactTags()}
            onRetryTypes={() => void inbox.loadContactTypes()}
            onSaveTags={inbox.replaceContactTags}
            onSetContactType={inbox.setContactType}
            onSetResponsible={(id) => void inbox.setResponsible(id)}
            pending={inbox.responsiblePending}
            tagSaveError={inbox.contactTagSaveError}
            tagSavePending={inbox.contactTagSavePendingId === selectedListItem?.contact.id}
            tagsError={inbox.contactTagsError}
            tagsLoading={inbox.contactTagsLoading}
            typeSaveError={inbox.contactTypeSaveError}
            typeSavePending={inbox.contactTypeSavePendingId === selectedListItem?.contact.id}
            typesError={inbox.contactTypesError}
            typesLoading={inbox.contactTypesLoading}
            users={inbox.users}
          />
        </DialogContent>
      </Dialog>
    </main>
  );
}
