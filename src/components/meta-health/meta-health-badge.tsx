"use client";

import { useMetaHealth } from "@/hooks/use-meta-health";
import { cn } from "@/lib/utils";
import type { MetaHealthLabel, MetaHealthSummaryDto } from "@/modules/meta-health/types";

const presentation: Record<MetaHealthLabel, { text: string; dot: string }> = {
  NORMAL: { text: "Meta normal", dot: "bg-[var(--accent)]" },
  ATTENTION: { text: "Meta em atenção", dot: "bg-[var(--attention-border)]" },
  CRITICAL: { text: "Meta crítica", dot: "bg-[var(--danger)]" },
  STALE: { text: "Meta sem atualização", dot: "bg-[var(--muted)]" },
};

export function MetaHealthBadge({ initialSummary }: { initialSummary: MetaHealthSummaryDto }) {
  const { summary } = useMetaHealth(initialSummary);
  const current = summary.connection?.state === "DISCONNECTED"
    ? { text: "WhatsApp desconectado", dot: "bg-[var(--danger)]" }
    : summary.label === "NORMAL" && (summary.connection?.state === "UNKNOWN" || summary.connection?.stale)
      ? { text: "Conexão a confirmar", dot: "bg-[var(--muted)]" }
      : presentation[summary.label];
  const count = summary.unacknowledgedCount;
  const accessibleName = count > 0
    ? `${current.text}, ${count} ${count === 1 ? "alerta não tratado" : "alertas não tratados"}`
    : current.text;

  return (
    <a
      aria-label={accessibleName}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-[11px] font-semibold text-[var(--muted)] transition-colors hover:bg-[var(--canvas)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-1"
      href="/configuracoes/meta"
    >
      <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", current.dot)} />
      <span className="whitespace-nowrap">{current.text}</span>
      {count > 0 ? (
        <span aria-hidden="true" className="inline-flex min-w-4 items-center justify-center rounded-full bg-[var(--text)] px-1 text-[10px] leading-4 text-[var(--canvas)]">
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </a>
  );
}
