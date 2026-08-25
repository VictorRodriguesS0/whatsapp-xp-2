"use client";

/* eslint-disable @next/next/no-img-element -- Catalog images require the authenticated same-origin resolver; the Next image optimizer does not carry the user's session. */

import { PackageOpen, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useCatalogProducts } from "@/hooks/use-catalog-products";
import { useMediaQuery } from "@/hooks/use-media-query";
import type { CatalogAvailability } from "@/modules/catalog/types";

const availabilityCopy: Record<CatalogAvailability, string> = {
  IN_STOCK: "Em estoque",
  OUT_OF_STOCK: "Sem estoque",
  PREORDER: "Pré-venda",
  AVAILABLE_FOR_ORDER: "Disponível sob encomenda",
  DISCONTINUED: "Descontinuado",
  UNKNOWN: "Disponibilidade não informada",
};

export function CatalogPicker({
  conversationId,
  onClose,
  open,
}: {
  conversationId: string;
  onClose(): void;
  open: boolean;
}) {
  const catalog = useCatalogProducts({ conversationId, open });
  const mobile = useMediaQuery("(max-width: 767px)");
  if (!open) return null;

  const content = (
    <>
      <header className="flex min-h-16 items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
        <div className="min-w-0">
          <h2 className="font-bold text-[var(--text)]" id="catalog-picker-heading">Produtos do catálogo</h2>
          <p className="mt-0.5 text-xs text-[var(--muted)]">Consulta ao catálogo oficial da XP.</p>
        </div>
        <Button aria-label="Fechar produtos" onClick={onClose} size="icon" variant="ghost">
          <X aria-hidden="true" className="size-4" />
        </Button>
      </header>
      <div className="border-b border-[var(--border)] p-4">
        <label className="relative block" htmlFor="catalog-product-search">
          <span className="sr-only">Buscar produtos</span>
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 size-4 text-[var(--muted)]" />
          <Input
            aria-label="Buscar produtos"
            autoFocus
            className="pl-9"
            id="catalog-product-search"
            onChange={(event) => catalog.setQuery(event.target.value)}
            placeholder="Nome ou código"
            type="search"
            value={catalog.query}
          />
        </label>
        {catalog.freshness === "STALE" ? (
          <p className="mt-2 text-xs font-semibold text-amber-700">Dados anteriores</p>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
        {catalog.loading ? (
          <div className="flex min-h-32 items-center justify-center"><Spinner label="Carregando produtos" /></div>
        ) : null}
        {!catalog.loading && catalog.error ? (
          <div className="border-y border-[var(--border)] py-5" role="alert">
            <p className="text-sm text-[var(--text)]">{catalog.error}</p>
            <Button className="mt-3" onClick={() => void catalog.retry()} size="small" variant="secondary">Tentar novamente</Button>
          </div>
        ) : null}
        {!catalog.loading && !catalog.error && catalog.items.length === 0 ? (
          <div className="flex min-h-40 flex-col items-center justify-center text-center text-[var(--muted)]">
            <PackageOpen aria-hidden="true" className="size-6" />
            <p className="mt-2 text-sm">Nenhum produto encontrado.</p>
          </div>
        ) : null}
        {!catalog.loading && !catalog.error && catalog.items.length > 0 ? (
          <ul className="divide-y divide-[var(--border)]">
            {catalog.items.map((product) => (
              <li className="py-4" key={product.retailerId}>
                <div className="flex gap-3">
                  {product.imagePath ? (
                    <img alt={product.name} className="size-20 shrink-0 rounded-lg bg-[var(--canvas)] object-cover" height="80" src={product.imagePath} width="80" />
                  ) : (
                    <img alt="" aria-hidden="true" className="size-20 shrink-0 rounded-lg bg-[var(--canvas)] object-cover" height="80" src="/catalog-product-placeholder.svg" width="80" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-bold text-[var(--text)]">{product.name}</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">{product.retailerId}</p>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                      <span className="font-semibold text-[var(--text)]">{product.priceText ?? "Preço não informado"}</span>
                      <span className="text-[var(--muted)]">{availabilityCopy[product.availability]}</span>
                    </div>
                    <Button className="mt-3 w-full" disabled size="small" variant="secondary">Disponível na próxima etapa</Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        {catalog.nextCursor && !catalog.error ? (
          <Button className="my-3 w-full" disabled={catalog.loadingMore} onClick={() => void catalog.loadMore()} variant="secondary">
            {catalog.loadingMore ? "Carregando…" : "Carregar mais produtos"}
          </Button>
        ) : null}
      </div>
    </>
  );

  if (mobile) {
    return (
      <section
        aria-labelledby="catalog-picker-heading"
        aria-modal="true"
        className="fixed inset-0 z-50 flex h-dvh flex-col bg-[var(--panel)]"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !event.defaultPrevented) {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        }}
        role="dialog"
      >
        {content}
      </section>
    );
  }
  return (
    <aside aria-labelledby="catalog-picker-heading" className="absolute inset-y-0 right-0 z-30 flex min-h-0 w-[min(22rem,100%)] flex-col border-l border-[var(--border)] bg-[var(--panel)] shadow-[-10px_0_24px_rgba(17,24,39,0.08)]" role="complementary">
      {content}
    </aside>
  );
}
