"use client";

import { LogOut, Menu, MessageSquareText, Settings, Tags } from "lucide-react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { AppBrand } from "@/components/brand/app-brand";
import { MetaHealthBadge } from "@/components/meta-health/meta-health-badge";
import { ThemeMenu } from "@/components/theme/theme-menu";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { SessionUser } from "@/modules/auth/session";
import type { MetaHealthSummaryDto } from "@/modules/meta-health/types";

type ConversationSidebarProps = {
  user: SessionUser;
  metaHealthSummary?: MetaHealthSummaryDto | null;
  searchMode: "conversations" | "messages";
  onSearchModeChange(value: "conversations" | "messages"): void;
  conversationList: ReactNode;
  messageSearchResults: ReactNode;
  conversationQuery: string;
  messageQuery: string;
  onConversationQueryChange(value: string): void;
  onMessageQueryChange(value: string): void;
  onLogout(): void;
} & Omit<ComponentPropsWithoutRef<"aside">, "children" | "className">;

export function ConversationSidebar({
  user,
  metaHealthSummary,
  searchMode,
  onSearchModeChange,
  conversationList,
  messageSearchResults,
  conversationQuery,
  messageQuery,
  onConversationQueryChange,
  onMessageQueryChange,
  onLogout,
  ...asideProps
}: ConversationSidebarProps) {
  const messageSearch = searchMode === "messages";
  const query = messageSearch ? messageQuery : conversationQuery;

  return (
    <aside {...asideProps} aria-label="Conversas" className="conversation-pane flex min-h-0 flex-col border-r border-[var(--border)] bg-[var(--panel)]" role="region">
      <header className="shrink-0 border-b border-[var(--border)] px-4 py-3">
        <div className="flex min-h-11 items-center justify-between gap-3">
          <div className="min-w-0">
            <AppBrand />
            <h1 className="text-lg font-bold tracking-tight text-[var(--text)]">Atendimento</h1>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {user.role === "ADMIN" && metaHealthSummary ? <MetaHealthBadge initialSummary={metaHealthSummary} /> : null}
            <ThemeMenu />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button aria-label="Abrir configurações" size="icon" variant="ghost"><Menu aria-hidden="true" className="size-4" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" aria-label="Configurações">
                <div className="grid gap-1">
                  <a className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium text-[var(--text)] outline-none hover:bg-[var(--surface)] focus-visible:ring-2 focus-visible:ring-[var(--focus)]" href="/configuracoes/respostas-rapidas" role="menuitem"><MessageSquareText aria-hidden="true" className="size-4" />Configurar respostas rápidas</a>
                  {user.role === "ADMIN" ? <>
                    <a className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium text-[var(--text)] outline-none hover:bg-[var(--surface)] focus-visible:ring-2 focus-visible:ring-[var(--focus)]" href="/configuracoes/atendimento" role="menuitem"><Tags aria-hidden="true" className="size-4" />Configurar classificações</a>
                    <a className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium text-[var(--text)] outline-none hover:bg-[var(--surface)] focus-visible:ring-2 focus-visible:ring-[var(--focus)]" href="/configuracoes/usuarios" role="menuitem"><Settings aria-hidden="true" className="size-4" />Configurar usuários</a>
                  </> : null}
                  <button className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-left text-sm font-medium text-[var(--text)] outline-none hover:bg-[var(--surface)] focus-visible:ring-2 focus-visible:ring-[var(--focus)]" onClick={onLogout} role="menuitem" type="button"><LogOut aria-hidden="true" className="size-4" />Sair</button>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div aria-label="Tipo de busca" className="mt-3 grid grid-cols-2 rounded-md bg-[var(--canvas)] p-1" role="group">
          <button aria-pressed={!messageSearch} className="min-h-11 rounded px-3 text-xs font-semibold text-[var(--muted)] transition-colors aria-pressed:bg-[var(--panel)] aria-pressed:text-[var(--accent)] aria-pressed:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] motion-reduce:transition-none" onClick={() => onSearchModeChange("conversations")} type="button">Conversas</button>
          <button aria-pressed={messageSearch} className="min-h-11 rounded px-3 text-xs font-semibold text-[var(--muted)] transition-colors aria-pressed:bg-[var(--panel)] aria-pressed:text-[var(--accent)] aria-pressed:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] motion-reduce:transition-none" onClick={() => onSearchModeChange("messages")} type="button">Mensagens</button>
        </div>
        <label className="relative mt-2 block" htmlFor="conversation-search">
          <span className="sr-only">{messageSearch ? "Buscar nas mensagens" : "Buscar conversas"}</span>
          <MessageSquareText aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 size-4 text-[var(--muted)]" />
          <Input aria-label={messageSearch ? "Buscar nas mensagens" : "Buscar conversas"} className="pl-9" id="conversation-search" onChange={(event) => messageSearch ? onMessageQueryChange(event.target.value) : onConversationQueryChange(event.target.value)} placeholder={messageSearch ? "Buscar nas mensagens" : "Buscar por nome ou telefone"} type="search" value={query} />
        </label>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{messageSearch ? messageSearchResults : conversationList}</div>
    </aside>
  );
}
