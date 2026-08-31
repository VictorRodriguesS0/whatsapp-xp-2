"use client";

import { ArrowLeft, Send, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { CatalogProductDto } from "@/modules/catalog/types";

export function CatalogSelectionReview({
  error,
  mode,
  onCancel,
  onConfirm,
  onRemove,
  pending,
  products,
}: {
  error: string | null;
  mode: "PRODUCT_LIST" | "CATALOG";
  onCancel(): void;
  onConfirm(): void;
  onRemove(retailerId: string): void;
  pending: boolean;
  products: CatalogProductDto[];
}) {
  const listMode = mode === "PRODUCT_LIST";
  const confirmLabel = listMode
    ? pending
      ? "Enviando produtos"
      : `Enviar ${products.length} ${products.length === 1 ? "produto" : "produtos"}`
    : pending ? "Enviando catálogo" : "Confirmar envio do catálogo";

  return (
    <section
      aria-label="Revisar envio do catálogo"
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }}
      role="region"
    >
      <header className="flex min-h-16 items-center gap-3 border-b border-[var(--border)] px-4 py-3">
        <Button aria-label="Voltar aos produtos" disabled={pending} onClick={onCancel} size="icon" variant="ghost">
          <ArrowLeft aria-hidden="true" className="size-4" />
        </Button>
        <div className="min-w-0">
          <h2 className="font-bold text-[var(--text)]" id="catalog-picker-heading">
            {listMode ? "Revisar produtos" : "Enviar catálogo completo?"}
          </h2>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            {listMode
              ? `${products.length} de 30 ${products.length === 1 ? "produto selecionado" : "produtos selecionados"}`
              : "O cliente receberá o catálogo oficial da XP no WhatsApp."}
          </p>
        </div>
      </header>

      {listMode ? (
        <ul className="min-h-0 flex-1 divide-y divide-[var(--border)] overflow-y-auto px-4">
          {products.map((product) => (
            <li className="flex min-h-16 items-center gap-3 py-3" key={product.retailerId}>
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-semibold text-[var(--text)]">{product.name}</p>
                <p className="mt-0.5 text-xs text-[var(--muted)]">{product.priceText ?? product.retailerId}</p>
              </div>
              <Button aria-label={`Remover ${product.name}`} disabled={pending} onClick={() => onRemove(product.retailerId)} size="icon" variant="ghost">
                <Trash2 aria-hidden="true" className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="min-h-0 flex-1 px-4 py-6 text-sm text-[var(--text)]">
          Produtos, preços e disponibilidade serão exibidos diretamente pelo WhatsApp.
        </div>
      )}

      <footer className="border-t border-[var(--border)] p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {error ? <p className="mb-3 text-sm text-[var(--danger)]" role="alert">{error}</p> : null}
        <Button
          aria-label={confirmLabel}
          className="min-h-11 w-full"
          disabled={pending || (listMode && products.length === 0)}
          onClick={onConfirm}
        >
          <Send aria-hidden="true" className="size-4" />
          {confirmLabel}
        </Button>
      </footer>
    </section>
  );
}
