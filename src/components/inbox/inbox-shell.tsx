"use client";

import { LogOut, Search, Settings } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useInbox } from "@/hooks/use-inbox";
import type { SessionUser } from "@/modules/auth/session";

import { ConnectionBanner } from "./connection-banner";
import { ConversationList } from "./conversation-list";
import { ConversationView } from "./conversation-view";
import { CustomerPanel } from "./customer-panel";

export function InboxShell({ initialUser }: { initialUser: SessionUser }) {
  const inbox = useInbox(initialUser);
  const [mobileView, setMobileView] = useState<"list" | "thread">("list");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const selectedListItem = inbox.conversations.find((item) => item.id === inbox.selectedId) ?? inbox.conversation;

  function selectConversation(id: string) {
    setMobileView("thread");
    void inbox.openConversation(id);
  }

  function backToList() {
    setMobileView("list");
    setDetailsOpen(false);
    inbox.closeConversation();
  }

  async function logout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.assign("/login");
    }
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
                  {initialUser.role === "ADMIN" ? <Button asChild aria-label="Configurar usuários" size="icon" variant="ghost"><a href="/configuracoes/usuarios"><Settings aria-hidden="true" className="size-4" /></a></Button> : null}
                  <Button aria-label="Sair" onClick={() => void logout()} size="icon" variant="ghost"><LogOut aria-hidden="true" className="size-4" /></Button>
                </div>
              </div>
              <label className="relative mt-3 block" htmlFor="conversation-search">
                <span className="sr-only">Buscar conversas</span>
                <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 size-4 text-[var(--muted)]" />
                <Input className="pl-9" id="conversation-search" onChange={(event) => inbox.setSearch(event.target.value)} placeholder="Buscar por nome ou telefone" type="search" value={inbox.search} />
              </label>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <ConversationList error={inbox.listError} items={inbox.conversations} loading={inbox.loadingList} onRetry={inbox.refreshList} onSelect={selectConversation} search={inbox.search} selectedId={inbox.selectedId} />
            </div>
          </aside>

          <section aria-label="Conversa ativa" className="thread-pane min-h-0 bg-[var(--panel)]">
            <ConversationView
              conversation={inbox.conversation}
              error={inbox.conversationError}
              loading={inbox.loadingConversation}
              onBack={backToList}
              onOpenDetails={() => setDetailsOpen(true)}
              onRetryLoad={inbox.refreshConversation}
              onRetryMessage={(id) => void inbox.retryMessage(id)}
              onSendMedia={(file, caption) => inbox.selectedId && inbox.conversation?.id === inbox.selectedId ? inbox.sendMedia(inbox.selectedId, file, caption) : Promise.resolve(null)}
              onSendText={(body) => inbox.selectedId && inbox.conversation?.id === inbox.selectedId ? inbox.sendText(inbox.selectedId, body) : Promise.resolve(null)}
              onVisibleMessage={(messageId) => {
                if (inbox.selectedId && inbox.conversation?.id === inbox.selectedId) void inbox.markRead(inbox.selectedId, messageId);
              }}
            />
          </section>

          <aside aria-label="Dados do cliente" className="customer-pane min-h-0 overflow-y-auto border-l border-[var(--border)] bg-[var(--panel)]">
            <CustomerPanel conversation={selectedListItem} currentUserId={initialUser.id} onSetResponsible={(id) => void inbox.setResponsible(id)} users={inbox.users} />
          </aside>
        </div>
      </div>

      <Dialog onOpenChange={setDetailsOpen} open={detailsOpen}>
        <DialogContent className="customer-dialog">
          <DialogTitle className="pr-12 text-lg font-bold text-[var(--text)]">Dados do cliente</DialogTitle>
          <DialogDescription className="sr-only">Contato e responsável pela conversa selecionada.</DialogDescription>
          <CustomerPanel conversation={selectedListItem} currentUserId={initialUser.id} onSetResponsible={(id) => void inbox.setResponsible(id)} users={inbox.users} />
        </DialogContent>
      </Dialog>
    </main>
  );
}
