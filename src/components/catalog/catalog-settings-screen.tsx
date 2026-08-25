"use client";

import { RefreshCw } from "lucide-react";

import { SettingsPageShell } from "@/components/layout/settings-page-shell";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useCatalogStatus } from "@/hooks/use-catalog-status";
import type { CatalogStatusDto } from "@/modules/catalog/types";

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});

function formattedDate(value: string | null): string {
  if (!value) return "Não disponível";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Não disponível" : dateFormatter.format(date);
}

function overallState(status: CatalogStatusDto): {
  label: string;
  dotClass: string;
} {
  if (!status.configured) return { label: "Não configurado", dotClass: "bg-[var(--muted)]" };
  if (status.freshness !== "FRESH" || status.errorCode) {
    return { label: "Requer atenção", dotClass: "bg-amber-500" };
  }
  if (!status.ready) return { label: "Configuração incompleta", dotClass: "bg-amber-500" };
  return { label: "Pronto para uso", dotClass: "bg-[var(--accent)]" };
}

function remediation(status: CatalogStatusDto): string[] {
  if (!status.configured) {
    return ["Configure o identificador do catálogo da XP no servidor para iniciar as consultas."];
  }
  const messages: string[] = [];
  if (status.errorCode === "CATALOG_PERMISSION_REQUIRED") {
    messages.push("Conceda ao usuário do sistema acesso ao catálogo no Gerenciador de Negócios da Meta.");
  } else if (status.errorCode === "CATALOG_NOT_FOUND") {
    messages.push("Confirme se o catálogo configurado ainda pertence à empresa XP Eletrônicos.");
  } else if (status.errorCode) {
    messages.push("A Meta não respondeu normalmente. Atualize novamente após alguns minutos.");
  }
  if (status.freshness === "STALE") {
    messages.push("Os últimos dados válidos continuam visíveis, mas precisam ser atualizados antes do envio de produtos.");
  }
  if (status.commerce && !status.commerce.catalogVisible) {
    messages.push("Ative a visibilidade do catálogo nas configurações de comércio do WhatsApp.");
  }
  if (status.commerce && !status.commerce.cartEnabled) {
    messages.push("Ative o carrinho nas configurações de comércio do WhatsApp.");
  }
  if (status.catalog?.productCount === 0) {
    messages.push("Cadastre e publique ao menos um produto no catálogo oficial da Meta.");
  }
  if (messages.length === 0 && status.ready) {
    messages.push("A integração está pronta. Os produtos continuam sendo administrados no catálogo oficial da Meta.");
  }
  return messages;
}

function countText(count: number | null | undefined): string {
  if (count === null || count === undefined) return "Não disponível";
  return `${count} ${count === 1 ? "produto" : "produtos"}`;
}

export function CatalogSettingsScreen({
  initialStatus,
}: {
  initialStatus: CatalogStatusDto;
}) {
  const catalog = useCatalogStatus(initialStatus);
  const state = overallState(catalog.status);
  const freshness = {
    FRESH: "Atualizado",
    STALE: "Dados anteriores",
    UNAVAILABLE: "Indisponível",
  }[catalog.status.freshness];

  return (
    <SettingsPageShell
      actions={(
        <Button disabled={catalog.refreshing} onClick={() => void catalog.refresh()} variant="secondary">
          {catalog.refreshing
            ? <Spinner label="Atualizando" />
            : <><RefreshCw aria-hidden="true" className="size-4" />Atualizar agora</>}
        </Button>
      )}
      description="Situação do catálogo oficial conectado ao número da XP Eletrônicos."
      eyebrow="Configurações"
      title="Catálogo do WhatsApp"
    >
      <section aria-labelledby="catalog-current-state" className="py-2">
        <div className="flex items-center gap-3 border-y border-[var(--border)] py-5">
          <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${state.dotClass}`} />
          <div>
            <h2 className="text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted)]" id="catalog-current-state">Situação atual</h2>
            <p className="mt-1 text-base font-bold text-[var(--text)]">{state.label}</p>
          </div>
        </div>
      </section>

      {catalog.notice ? (
        <p className="mt-5 border-l-2 border-[var(--accent)] pl-4 text-sm text-[var(--text)]" role="status">
          {catalog.notice}
        </p>
      ) : null}

      <section aria-labelledby="catalog-details" className="py-7">
        <h2 className="text-base font-bold" id="catalog-details">Dados conectados</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">Leitura direta do catálogo administrado na Meta.</p>
        <dl className="mt-4 grid border-y border-[var(--border)] sm:grid-cols-2 lg:grid-cols-3">
          {[
            ["Catálogo", catalog.status.catalog?.name ?? "Não disponível"],
            ["Identificador", catalog.status.catalog?.idSuffix ?? "Não disponível"],
            ["Produtos", countText(catalog.status.catalog?.productCount)],
            ["Visibilidade", catalog.status.commerce?.catalogVisible ? "Visível no WhatsApp" : catalog.status.commerce ? "Oculto no WhatsApp" : "Não disponível"],
            ["Carrinho", catalog.status.commerce?.cartEnabled ? "Carrinho ativo" : catalog.status.commerce ? "Carrinho inativo" : "Não disponível"],
            ["Última leitura", formattedDate(catalog.status.lastSuccessAt)],
          ].map(([label, value]) => (
            <div className="border-b border-[var(--border)] px-1 py-4 last:border-b-0 sm:px-4 sm:[&:nth-last-child(-n+2)]:border-b-0 lg:[&:nth-last-child(-n+3)]:border-b-0" key={label}>
              <dt className="text-xs font-semibold text-[var(--muted)]">{label}</dt>
              <dd className="mt-1 break-words text-sm font-bold text-[var(--text)]">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="catalog-data-state" className="border-t border-[var(--border)] py-7">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-bold" id="catalog-data-state">Estado dos dados</h2>
          <span className="text-xs font-bold text-[var(--muted)]">{freshness}</span>
        </div>
        <ul className="mt-4 divide-y divide-[var(--border)] border-y border-[var(--border)]">
          {remediation(catalog.status).map((message) => (
            <li className="py-4 text-sm text-[var(--text)]" key={message}>{message}</li>
          ))}
        </ul>
      </section>
    </SettingsPageShell>
  );
}
