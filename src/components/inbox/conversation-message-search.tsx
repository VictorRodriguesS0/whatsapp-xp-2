"use client";

import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMessageSearch } from "@/hooks/use-message-search";
import type { MessageSearchResultDto } from "@/modules/message-search/types";

export function ConversationMessageSearch({
  conversationId,
  onTarget,
}: {
  conversationId: string;
  onTarget: (result: MessageSearchResultDto) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const search = useMessageSearch({ scope: "conversation", conversationId });

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function close() {
    setOpen(false);
    search.reset();
    queueMicrotask(() => triggerRef.current?.focus());
  }

  function move(delta: number) {
    if (search.items.length === 0) return;
    const index = (search.activeIndex + delta + search.items.length) % search.items.length;
    search.setActiveIndex(index);
    onTarget(search.items[index]);
  }

  return (
    <>
      <Button
        asChild
        aria-expanded={open}
        aria-label="Pesquisar nesta conversa"
        onClick={() => setOpen((current) => !current)} size="icon" variant="ghost"
      >
        <button ref={triggerRef} type="button"><Search aria-hidden="true" className="size-5" /></button>
      </Button>
      {open ? (
        <div className="order-last flex min-h-12 basis-full items-center gap-1 border-t border-[var(--border)] bg-[var(--panel)] px-3 py-1.5">
          <Search aria-hidden="true" className="ml-1 size-4 shrink-0 text-[var(--muted)]" />
          <Input
            aria-label="Pesquisar nesta conversa"
            className="min-w-0 flex-1 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
            onChange={(event) => search.setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                close();
                return;
              }
              if (event.key === "Enter") {
                event.preventDefault();
                move(event.shiftKey ? -1 : 1);
              }
            }}
            placeholder="Buscar no histórico"
            ref={inputRef}
            type="search"
            value={search.query}
          />
          <span aria-live="polite" className="min-w-12 shrink-0 text-center text-xs tabular-nums text-[var(--muted)]">
            {search.loading ? "…" : search.items.length > 0 ? `${search.activeIndex + 1} de ${search.items.length}` : "0 de 0"}
          </span>
          <Button aria-label="Ocorrência anterior" disabled={search.items.length === 0} onClick={() => move(-1)} size="icon" variant="ghost"><ChevronUp aria-hidden="true" className="size-4" /></Button>
          <Button aria-label="Próxima ocorrência" disabled={search.items.length === 0} onClick={() => move(1)} size="icon" variant="ghost"><ChevronDown aria-hidden="true" className="size-4" /></Button>
          <Button aria-label="Fechar pesquisa" onClick={close} size="icon" variant="ghost"><X aria-hidden="true" className="size-4" /></Button>
          {search.error ? <span className="sr-only" role="alert">{search.error}</span> : null}
        </div>
      ) : null}
    </>
  );
}
