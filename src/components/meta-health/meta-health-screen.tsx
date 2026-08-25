"use client";

import { LogOut, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { SettingsPageShell } from "@/components/layout/settings-page-shell";
import { Spinner } from "@/components/ui/spinner";
import { useMetaHealth } from "@/hooks/use-meta-health";
import type {
  MetaAlertPageDto,
  MetaHealthSummaryDto,
  MetaOperationalAlertDto,
  MetaSyncResult,
} from "@/modules/meta-health/types";

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});

const qualityCopy: Record<string, string> = {
  GREEN: "Normal",
  YELLOW: "Em atenção",
  RED: "Crítica",
  NA: "Ainda não classificada",
};

const reviewCopy: Record<string, string> = {
  APPROVED: "Aprovada",
  PENDING: "Pendente",
  REJECTED: "Rejeitada",
};

const categoryCopy: Record<MetaOperationalAlertDto["category"], string> = {
  PHONE_QUALITY: "Qualidade do número",
  ACCOUNT: "Conta",
  ACCOUNT_REVIEW: "Revisão da conta",
  PHONE_NAME: "Nome comercial",
  TEMPLATE: "Template",
};

const severityCopy: Record<MetaOperationalAlertDto["severity"], string> = {
  INFO: "Informativo",
  ATTENTION: "Atenção",
  CRITICAL: "Crítico",
};

const severityClass: Record<MetaOperationalAlertDto["severity"], string> = {
  INFO: "text-[var(--muted)]",
  ATTENTION: "text-[var(--attention-text)]",
  CRITICAL: "text-[var(--danger)]",
};

function formatDate(value: string | null): string {
  if (!value) return "Sem registro";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Sem registro" : dateFormatter.format(date);
}

function syncErrorCopy(code: string | null): string | null {
  if (!code) return null;
  if (code === "META_TIMEOUT") return "A última consulta à Meta não respondeu a tempo.";
  if (code === "META_UNAUTHORIZED") return "A Meta recusou a credencial configurada.";
  if (code === "META_RATE_LIMITED") return "A Meta limitou temporariamente as consultas.";
  if (code === "META_INVALID_RESPONSE") return "A Meta retornou dados que não puderam ser validados.";
  return "A última consulta à Meta não pôde ser concluída.";
}

function AlertList({
  alerts,
  errors,
  onAcknowledge,
  pendingIds,
}: {
  alerts: MetaOperationalAlertDto[];
  errors: Map<string, string>;
  onAcknowledge(alert: MetaOperationalAlertDto): void;
  pendingIds: Set<string>;
}) {
  if (alerts.length === 0) {
    return <p className="border-y border-[var(--border)] py-5 text-sm text-[var(--muted)]">Nenhum evento nesta seção.</p>;
  }
  return (
    <ol className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
      {alerts.map((alert) => (
        <li className="py-4" key={alert.id}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted)]">
                {categoryCopy[alert.category]} · <span className={severityClass[alert.severity]}>{severityCopy[alert.severity]}</span>
              </p>
              <p className="mt-1 text-sm font-semibold text-[var(--text)]">{alert.summary}</p>
              <p className="mt-1 text-xs text-[var(--muted)]">{formatDate(alert.occurredAt)}</p>
              {alert.acknowledgedBy ? (
                <p className="mt-2 text-xs font-semibold text-[var(--accent)]" tabIndex={-1}>
                  Tratado por {alert.acknowledgedBy.name}
                </p>
              ) : null}
              {errors.get(alert.id) ? (
                <p className="mt-2 text-sm text-[var(--danger)]" role="alert">{errors.get(alert.id)}</p>
              ) : null}
            </div>
            {!alert.acknowledgedAt ? (
              <Button
                aria-label="Marcar como tratado"
                disabled={pendingIds.has(alert.id)}
                onClick={() => onAcknowledge(alert)}
                size="small"
                variant="secondary"
              >
                {pendingIds.has(alert.id) ? "Salvando…" : "Marcar como tratado"}
              </Button>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function MetaHealthScreen({
  initialAlerts,
  initialSummary,
}: {
  initialAlerts: MetaAlertPageDto;
  initialSummary: MetaHealthSummaryDto;
}) {
  const router = useRouter();
  const health = useMetaHealth(initialSummary);
  const [alerts, setAlerts] = useState(initialAlerts.alerts);
  const [nextCursor, setNextCursor] = useState(initialAlerts.nextCursor);
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  const [acknowledgeErrors, setAcknowledgeErrors] = useState<Map<string, string>>(() => new Map());
  const [loadingMore, setLoadingMore] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [logoutPending, setLogoutPending] = useState(false);
  const mounted = useRef(true);

  useEffect(() => () => { mounted.current = false; }, []);

  const activeAlerts = alerts.filter((alert) => alert.active);
  const historyAlerts = alerts.filter((alert) => !alert.active);
  const syncFailure = syncErrorCopy(health.summary.lastSyncErrorCode);

  async function acknowledge(alert: MetaOperationalAlertDto) {
    if (pendingIds.has(alert.id)) return;
    setPendingIds((current) => new Set(current).add(alert.id));
    setAcknowledgeErrors((current) => {
      const next = new Map(current);
      next.delete(alert.id);
      return next;
    });
    try {
      const response = await fetch(`/api/meta-health/alerts/${alert.id}/acknowledge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const payload = (await response.json()) as { alert?: MetaOperationalAlertDto };
      if (!response.ok || !payload.alert?.acknowledgedAt) throw new Error("invalid response");
      if (mounted.current) {
        setAlerts((current) => current.map((item) => item.id === alert.id ? payload.alert! : item));
      }
      await health.refresh(false);
    } catch {
      if (mounted.current) {
        setAcknowledgeErrors((current) => new Map(current).set(
          alert.id,
          "Não foi possível marcar o alerta como tratado. Tente novamente.",
        ));
      }
    } finally {
      if (mounted.current) {
        setPendingIds((current) => {
          const next = new Set(current);
          next.delete(alert.id);
          return next;
        });
      }
    }
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setHistoryError(null);
    try {
      const params = new URLSearchParams({
        limit: "30",
        cursorOccurredAt: nextCursor.occurredAt,
        cursorId: nextCursor.id,
      });
      const response = await fetch(`/api/meta-health/alerts?${params.toString()}`, {
        headers: { Accept: "application/json" },
      });
      const page = (await response.json()) as MetaAlertPageDto;
      if (!response.ok || !Array.isArray(page.alerts)) throw new Error("invalid response");
      if (mounted.current) {
        setAlerts((current) => {
          const ids = new Set(current.map(({ id }) => id));
          return [...current, ...page.alerts.filter((alert) => !ids.has(alert.id))];
        });
        setNextCursor(page.nextCursor);
      }
    } catch {
      if (mounted.current) setHistoryError("Não foi possível carregar o histórico anterior.");
    } finally {
      if (mounted.current) setLoadingMore(false);
    }
  }

  async function reloadLatestAlerts() {
    try {
      const response = await fetch("/api/meta-health/alerts?limit=30", {
        headers: { Accept: "application/json" },
      });
      const page = (await response.json()) as MetaAlertPageDto;
      if (!response.ok || !Array.isArray(page.alerts) || !mounted.current) return;
      setAlerts((current) => {
        const latestIds = new Set(page.alerts.map(({ id }) => id));
        return [...page.alerts, ...current.filter(({ id }) => !latestIds.has(id))];
      });
      setNextCursor(page.nextCursor);
    } catch {
      // The current server-rendered history remains authoritative enough to keep operating.
    }
  }

  async function synchronize() {
    setSyncNotice(null);
    const result: MetaSyncResult | null = await health.sync();
    if (!mounted.current) return;
    if (!result) setSyncNotice("Não foi possível consultar a Meta agora.");
    else if (result.status === "RATE_LIMITED") setSyncNotice("Aguarde um minuto antes de atualizar novamente.");
    else if (result.status === "BUSY") setSyncNotice("A atualização já está em andamento.");
    else if (!result.success) setSyncNotice("A consulta terminou sem atualizar os dados.");
    else {
      setSyncNotice(result.status === "FRESH" ? "Os dados já estavam atualizados." : "Dados atualizados.");
      await reloadLatestAlerts();
    }
  }

  async function logout() {
    if (logoutPending) return;
    setLogoutPending(true);
    try { await fetch("/api/auth/logout", { method: "POST" }); } catch { /* local navigation remains available */ }
    try { await Promise.resolve(router.replace("/login")); } catch { /* navigation cancellation is non-fatal */ }
    if (mounted.current) setLogoutPending(false);
  }

  return (
    <SettingsPageShell
      actions={(
        <>
            <Button disabled={health.syncing} onClick={() => void synchronize()} variant="secondary">
              {health.syncing ? <Spinner label="Atualizando" /> : <><RefreshCw aria-hidden="true" className="size-4" />Atualizar agora</>}
            </Button>
            <Button aria-label="Sair" disabled={logoutPending} onClick={() => void logout()} size="icon" variant="ghost">
              <LogOut aria-hidden="true" className="size-4" />
            </Button>
        </>
      )}
      description="Qualidade do número, situação da conta e alertas recebidos pela integração oficial."
      eyebrow="Configurações"
      title="Saúde da Meta"
    >
        {(health.summary.stale || syncFailure || syncNotice) ? (
          <div className="mt-5 border-l-2 border-[var(--attention-border)] pl-4 text-sm text-[var(--attention-text)]" role="status">
            {health.summary.stale ? <p>Os dados da Meta estão sem atualização recente.</p> : null}
            {syncFailure ? <p>{syncFailure}</p> : null}
            {syncNotice ? <p>{syncNotice}</p> : null}
          </div>
        ) : null}

        <section aria-labelledby="current-meta-state" className="py-7">
          <h2 className="text-base font-bold" id="current-meta-state">Situação atual</h2>
          <dl className="mt-4 grid border-y border-[var(--border)] sm:grid-cols-2 lg:grid-cols-3">
            {[
              ["Número", health.summary.phone.displayPhoneNumber ?? "Não informado"],
              ["Nome verificado", health.summary.phone.verifiedName ?? "Não informado"],
              ["Qualidade do número", qualityCopy[health.summary.phone.qualityRating ?? ""] ?? "Não informada"],
              ["Revisão da conta", reviewCopy[health.summary.account.reviewStatus ?? ""] ?? "Não informada"],
              ["Limite de mensagens", health.summary.account.messagingLimit ?? "Não informado"],
              ["Última sincronização", formatDate(health.summary.lastSuccessfulSyncAt)],
            ].map(([label, value]) => (
              <div className="border-b border-[var(--border)] px-1 py-4 last:border-b-0 sm:px-4 sm:[&:nth-last-child(-n+2)]:border-b-0 lg:[&:nth-last-child(-n+3)]:border-b-0" key={label}>
                <dt className="text-xs font-semibold text-[var(--muted)]">{label}</dt>
                <dd className="mt-1 text-sm font-bold text-[var(--text)]">{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="active-alerts-heading" className="border-t border-[var(--border)] py-7" role="region">
          <div className="mb-4 flex items-end justify-between gap-3">
            <div><h2 className="text-base font-bold" id="active-alerts-heading">Alertas ativos</h2><p className="mt-1 text-sm text-[var(--muted)]">O tratamento registra atenção da equipe; somente a Meta encerra o estado operacional.</p></div>
            <span className="text-xs font-bold text-[var(--muted)]">{activeAlerts.length}</span>
          </div>
          <AlertList alerts={activeAlerts} errors={acknowledgeErrors} onAcknowledge={(alert) => void acknowledge(alert)} pendingIds={pendingIds} />
        </section>

        <section aria-labelledby="operational-history-heading" className="border-t border-[var(--border)] py-7" role="region">
          <h2 className="text-base font-bold" id="operational-history-heading">Histórico operacional</h2>
          <p className="mb-4 mt-1 text-sm text-[var(--muted)]">Eventos encerrados, em ordem do mais recente.</p>
          <AlertList alerts={historyAlerts} errors={acknowledgeErrors} onAcknowledge={(alert) => void acknowledge(alert)} pendingIds={pendingIds} />
          {historyError ? <p className="mt-3 text-sm text-[var(--danger)]" role="alert">{historyError}</p> : null}
          {nextCursor ? (
            <Button className="mt-4" disabled={loadingMore} onClick={() => void loadMore()} variant="secondary">
              {loadingMore ? "Carregando…" : "Carregar histórico anterior"}
            </Button>
          ) : null}
        </section>
    </SettingsPageShell>
  );
}
