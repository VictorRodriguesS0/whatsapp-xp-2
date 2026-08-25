"use client";

import { CheckCircle2, RefreshCw, ShieldCheck, ShieldOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { SettingsPageShell } from "@/components/layout/settings-page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { publicErrorMessage } from "@/lib/public-error";
import type {
  WhatsAppPolicySettingsDto,
  WhatsAppTemplateSummaryDto,
} from "@/modules/templates/types";

type Notice = { kind: "error" | "success"; text: string };
type Confirmation = "ACTIVE" | "INACTIVE" | null;
type MutationOptions = {
  restoreConfirmationFocus?: boolean;
};

const readinessCopy: Record<Exclude<WhatsAppPolicySettingsDto["readinessReason"], null>, string> = {
  NO_ASSIGNMENT: "Selecione um modelo aprovado",
  TEMPLATE_INELIGIBLE: "O modelo selecionado não está elegível",
  SYNC_STALE: "A sincronização precisa ser atualizada",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function parseTemplate(value: unknown): WhatsAppTemplateSummaryDto | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.language !== "string" ||
    typeof value.category !== "string" ||
    typeof value.status !== "string" ||
    !nullableString(value.qualityScore) ||
    typeof value.supported !== "boolean" ||
    typeof value.bodyText !== "string" ||
    !Number.isInteger(value.parameterCount) ||
    typeof value.syncedAt !== "string" ||
    typeof value.assigned !== "boolean"
  ) return null;

  return {
    id: value.id,
    name: value.name,
    language: value.language,
    category: value.category,
    status: value.status,
    qualityScore: value.qualityScore,
    supported: value.supported,
    bodyText: value.bodyText,
    parameterCount: value.parameterCount as number,
    syncedAt: value.syncedAt,
    assigned: value.assigned,
  };
}

function parseSettings(value: unknown): WhatsAppPolicySettingsDto | null {
  if (!isRecord(value) || (value.mode !== "INACTIVE" && value.mode !== "ACTIVE")) return null;
  if (!Number.isInteger(value.version) || (value.version as number) < 0) return null;
  if (!isRecord(value.lastSync) || !Array.isArray(value.templates)) return null;
  if (
    value.lastSync.status !== "NEVER" &&
    value.lastSync.status !== "SUCCEEDED" &&
    value.lastSync.status !== "FAILED"
  ) return null;
  if (
    !nullableString(value.lastSync.attemptedAt) ||
    !nullableString(value.lastSync.succeededAt) ||
    !nullableString(value.lastSync.failureCode)
  ) return null;

  const templates: WhatsAppTemplateSummaryDto[] = [];
  for (const rawTemplate of value.templates) {
    const template = parseTemplate(rawTemplate);
    if (!template) return null;
    templates.push(template);
  }

  let assignment: WhatsAppPolicySettingsDto["assignment"] = null;
  if (value.assignment !== null) {
    if (
      !isRecord(value.assignment) ||
      typeof value.assignment.templateId !== "string" ||
      typeof value.assignment.name !== "string" ||
      typeof value.assignment.language !== "string" ||
      typeof value.assignment.previewBody !== "string"
    ) return null;
    assignment = {
      templateId: value.assignment.templateId,
      name: value.assignment.name,
      language: value.assignment.language,
      previewBody: value.assignment.previewBody,
    };
  }

  if (typeof value.canActivate !== "boolean") return null;
  if (
    value.readinessReason !== null &&
    value.readinessReason !== "NO_ASSIGNMENT" &&
    value.readinessReason !== "TEMPLATE_INELIGIBLE" &&
    value.readinessReason !== "SYNC_STALE"
  ) return null;

  return {
    mode: value.mode,
    version: value.version as number,
    lastSync: {
      status: value.lastSync.status,
      attemptedAt: value.lastSync.attemptedAt,
      succeededAt: value.lastSync.succeededAt,
      failureCode: value.lastSync.failureCode,
    },
    templates,
    assignment,
    canActivate: value.canActivate,
    readinessReason: value.readinessReason,
  };
}

function parseEnvelope(value: unknown): WhatsAppPolicySettingsDto | null {
  if (!isRecord(value) || value.error !== null) return null;
  return parseSettings(value.data);
}

function responseErrorCode(value: unknown): string | undefined {
  if (!isRecord(value) || !isRecord(value.error)) return undefined;
  return typeof value.error.code === "string" ? value.error.code : undefined;
}

async function readJson(response: Response): Promise<unknown | null> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function eligible(template: WhatsAppTemplateSummaryDto) {
  return template.status === "APPROVED" &&
    template.supported &&
    template.language === "pt_BR" &&
    template.parameterCount === 1;
}

function formatDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(date);
}

function formatSync(settings: WhatsAppPolicySettingsDto) {
  if (settings.lastSync.status === "NEVER") return "Ainda não sincronizado";
  const succeededAt = formatDate(settings.lastSync.succeededAt);
  if (settings.lastSync.status === "FAILED") {
    return succeededAt
      ? `A última tentativa falhou · última válida em ${succeededAt}`
      : "A última tentativa falhou";
  }
  if (!succeededAt) return "Sincronização concluída";
  return succeededAt;
}

function statusLabel(status: string) {
  if (status === "APPROVED") return "Aprovado";
  if (status === "PENDING") return "Em análise";
  if (status === "REJECTED") return "Rejeitado";
  return status;
}

export function WhatsAppPolicyScreen({
  initialSettings,
}: {
  initialSettings: WhatsAppPolicySettingsDto;
}) {
  const router = useRouter();
  const [settings, setSettings] = useState(initialSettings);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    initialSettings.assignment?.templateId ?? null,
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const busyRef = useRef(false);
  const confirmationTrigger = useRef<HTMLButtonElement | null>(null);

  const selectedTemplate = useMemo(
    () => settings.templates.find((template) => template.id === selectedTemplateId) ?? null,
    [selectedTemplateId, settings.templates],
  );
  const preview = selectedTemplate
    ? selectedTemplate.bodyText.replaceAll("{{1}}", "cliente")
    : settings.assignment?.previewBody ?? null;
  const hasUnassignedSelection = Boolean(
    selectedTemplateId && selectedTemplateId !== settings.assignment?.templateId,
  );
  const activationReady = settings.canActivate && !hasUnassignedSelection;

  function applyAuthoritativeSettings(next: WhatsAppPolicySettingsDto) {
    setSettings(next);
    setSelectedTemplateId((current) => {
      if (next.assignment) return next.assignment.templateId;
      return next.templates.some((template) => template.id === current) ? current : null;
    });
  }

  async function reconcileSettings() {
    let response: Response;
    try {
      response = await fetch("/api/settings/whatsapp", {
        cache: "no-store",
        method: "GET",
      });
    } catch {
      return;
    }
    if (response.status === 401) {
      try {
        await Promise.resolve(router.replace("/login?motivo=sessao-expirada"));
      } catch {
        // A navegação cancelada não altera o erro seguro já preparado.
      }
      return;
    }
    if (!response.ok) return;
    const next = parseEnvelope(await readJson(response));
    if (next) applyAuthoritativeSettings(next);
  }

  async function mutate(
    url: string,
    method: "POST" | "PATCH",
    body: object,
    success: string,
    options: MutationOptions = {},
  ) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    try {
      let response: Response;
      try {
        response = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch {
        await reconcileSettings();
        setNotice({ kind: "error", text: "Sem conexão. Confira sua rede e tente novamente." });
        return;
      }

      if (response.status === 401) {
        try {
          await Promise.resolve(router.replace("/login?motivo=sessao-expirada"));
        } catch {
          // A navegação cancelada não deve expor detalhes nem travar novas tentativas.
        }
        return;
      }

      const json = await readJson(response);
      if (!response.ok) {
        const text = publicErrorMessage(
          "whatsapp-policy-save",
          response.status,
          false,
          responseErrorCode(json),
        );
        await reconcileSettings();
        setNotice({
          kind: "error",
          text,
        });
        return;
      }

      const next = parseEnvelope(json);
      if (!next) {
        await reconcileSettings();
        setNotice({ kind: "error", text: "Resposta inesperada do servidor. Tente novamente." });
        return;
      }

      applyAuthoritativeSettings(next);
      setNotice({ kind: "success", text: success });
    } finally {
      busyRef.current = false;
      setBusy(false);
      if (options.restoreConfirmationFocus) {
        const trigger = confirmationTrigger.current;
        confirmationTrigger.current = null;
        window.setTimeout(() => {
          if (trigger?.isConnected && !trigger.disabled) trigger.focus();
        }, 0);
      }
    }
  }

  function synchronize() {
    void mutate(
      "/api/settings/whatsapp/sync",
      "POST",
      {},
      "Modelos sincronizados com a Meta.",
    );
  }

  function assignTemplate() {
    if (!selectedTemplate || !eligible(selectedTemplate)) return;
    void mutate(
      "/api/settings/whatsapp",
      "PATCH",
      { action: "ASSIGN_TEMPLATE", templateId: selectedTemplate.id },
      "Modelo de retomada atualizado.",
    );
  }

  function requestMode(mode: Exclude<Confirmation, null>, trigger: HTMLButtonElement) {
    confirmationTrigger.current = trigger;
    setNotice(null);
    setConfirmation(mode);
  }

  function restoreConfirmationFocus(event: { preventDefault(): void }) {
    event.preventDefault();
    if (busyRef.current) return;
    const trigger = confirmationTrigger.current;
    confirmationTrigger.current = null;
    if (trigger?.isConnected) trigger.focus();
  }

  function updateMode(mode: Exclude<Confirmation, null>) {
    setConfirmation(null);
    void mutate(
      "/api/settings/whatsapp",
      "PATCH",
      { action: "SET_MODE", mode },
      mode === "ACTIVE" ? "Proteção da janela ativada." : "Proteção da janela desativada.",
      { restoreConfirmationFocus: true },
    );
  }

  const readiness = settings.mode === "ACTIVE"
    ? "Proteção em operação"
    : hasUnassignedSelection
      ? "Salve o modelo selecionado antes de ativar"
      : settings.canActivate
      ? "Pronta para ativar"
      : settings.readinessReason
        ? readinessCopy[settings.readinessReason]
        : "Verificação necessária";

  return (
    <>
      <SettingsPageShell
        actions={(
          <Button disabled={busy} onClick={synchronize} variant="secondary">
            {busy ? <Spinner label="Sincronizando" /> : <><RefreshCw aria-hidden="true" className="size-4" />Sincronizar com a Meta</>}
          </Button>
        )}
        description="Controle o modelo aprovado usado para retomar conversas depois da janela de 24 horas."
        eyebrow="Configurações"
        title="WhatsApp e janela de atendimento"
      >
          <section aria-labelledby="policy-status-heading" className="mt-7">
            <h2 className="text-lg font-bold" id="policy-status-heading">Estado operacional</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">A ativação só é liberada com sincronização recente e modelo compatível.</p>

            <dl className="mt-4 divide-y divide-[var(--border)] border-y border-[var(--border)] bg-[var(--panel)]">
              <div className="grid gap-1 px-4 py-3 sm:grid-cols-[14rem_1fr] sm:items-center"><dt className="text-sm font-semibold">Proteção da janela</dt><dd><Badge className={settings.mode === "ACTIVE" ? "bg-[var(--accent)]" : "bg-[var(--canvas)] text-[var(--muted)]"}>{settings.mode === "ACTIVE" ? "Proteção ativa" : "Proteção desativada"}</Badge></dd></div>
              <div className="grid gap-1 px-4 py-3 sm:grid-cols-[14rem_1fr] sm:items-center"><dt className="text-sm font-semibold">Última sincronização</dt><dd className="text-sm text-[var(--muted)]">{formatSync(settings)}</dd></div>
              <div className="grid gap-1 px-4 py-3 sm:grid-cols-[14rem_1fr] sm:items-center"><dt className="text-sm font-semibold">Modelo de retomada</dt><dd className="break-words text-sm text-[var(--muted)]">{settings.assignment ? `${settings.assignment.name} · ${settings.assignment.language}` : "Nenhum modelo selecionado"}</dd></div>
              <div className="grid gap-1 px-4 py-3 sm:grid-cols-[14rem_1fr] sm:items-center"><dt className="text-sm font-semibold">Prontidão</dt><dd className="flex items-center gap-2 text-sm text-[var(--muted)]">{activationReady || settings.mode === "ACTIVE" ? <CheckCircle2 aria-hidden="true" className="size-4 text-[var(--accent)]" /> : null}{readiness}</dd></div>
            </dl>
          </section>

          <section aria-labelledby="template-selection-heading" className="mt-8 border-t border-[var(--border)] pt-6">
            <h2 className="text-lg font-bold" id="template-selection-heading">Seleção do modelo</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--muted)]">Somente modelos aprovados em português do Brasil e compatíveis com uma variável de nome podem ser usados.</p>

            <div aria-labelledby="template-selection-heading" className="mt-4" role="radiogroup">
              {settings.templates.length === 0 ? (
                <p className="border-y border-[var(--border)] bg-[var(--panel)] px-4 py-7 text-sm text-[var(--muted)]">Nenhum modelo sincronizado. Sincronize para consultar os modelos disponíveis.</p>
              ) : (
                <ul className="divide-y divide-[var(--border)] border-y border-[var(--border)] bg-[var(--panel)]">
                {settings.templates.map((template) => {
                  const canSelect = eligible(template);
                  return (
                    <li className="px-4 py-3" key={template.id}>
                      <label className={canSelect ? "flex min-h-11 cursor-pointer items-start gap-3" : "flex min-h-11 cursor-not-allowed items-start gap-3 opacity-55"}>
                        <input
                          aria-label={`${template.name}, ${statusLabel(template.status)}`}
                          checked={selectedTemplateId === template.id}
                          className="mt-1 size-4 accent-[var(--accent)]"
                          disabled={!canSelect || busy}
                          name="service-resumption-template"
                          onChange={() => setSelectedTemplateId(template.id)}
                          type="radio"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2"><span className="break-words text-sm font-semibold">{template.name}</span><Badge className={template.status === "APPROVED" ? "bg-[var(--selected)] text-[var(--accent)]" : "bg-[var(--canvas)] text-[var(--muted)]"}>{statusLabel(template.status)}</Badge>{template.assigned ? <Badge>Em uso</Badge> : null}</span>
                          <span className="mt-1 block text-xs text-[var(--muted)]">{template.language} · {template.category}{template.qualityScore ? ` · qualidade ${template.qualityScore}` : ""}{!template.supported ? " · formato não suportado" : ""}</span>
                        </span>
                      </label>
                    </li>
                  );
                })}
                </ul>
              )}
            </div>

            <div className="mt-5 border-l-4 border-[var(--accent)] bg-[var(--panel)] px-4 py-4">
              <p className="text-xs font-bold uppercase tracking-[0.1em] text-[var(--accent)]">Prévia exata</p>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-[var(--text)] [overflow-wrap:anywhere]">{preview ?? "Selecione um modelo elegível para conferir a mensagem."}</p>
            </div>
            <div className="mt-4 flex justify-end">
              <Button disabled={busy || !selectedTemplate || !eligible(selectedTemplate) || settings.assignment?.templateId === selectedTemplate.id} onClick={assignTemplate} variant="secondary">Usar para retomada</Button>
            </div>
          </section>

          <section aria-labelledby="activation-heading" className="mt-8 border-t border-[var(--border)] pt-6">
            <h2 className="text-lg font-bold" id="activation-heading">Ativação</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--muted)]">Ao ativar, mensagens livres fora da janela serão bloqueadas e a retomada usará apenas o modelo aprovado selecionado.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {settings.mode === "ACTIVE" ? (
                <Button disabled={busy} onClick={(event) => requestMode("INACTIVE", event.currentTarget)} variant="danger"><ShieldOff aria-hidden="true" className="size-4" />Desativar proteção</Button>
              ) : (
                <Button disabled={busy || !activationReady} onClick={(event) => requestMode("ACTIVE", event.currentTarget)}><ShieldCheck aria-hidden="true" className="size-4" />Ativar proteção</Button>
              )}
            </div>
          </section>

          {notice ? (
            <div aria-atomic="true" aria-live="polite" className={`mt-6 border-l-4 bg-[var(--panel)] px-4 py-3 text-sm font-semibold ${notice.kind === "error" ? "border-[var(--danger)]" : "border-[var(--accent)]"}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</div>
          ) : null}
      </SettingsPageShell>

      <AlertDialog onOpenChange={(open) => { if (!open && !busy) setConfirmation(null); }} open={confirmation !== null}>
        <AlertDialogContent className="modal-dialog" onCloseAutoFocus={restoreConfirmationFocus}>
          <AlertDialogTitle className="text-xl font-bold">{confirmation === "ACTIVE" ? "Ativar proteção da janela" : "Desativar proteção da janela"}</AlertDialogTitle>
          <AlertDialogDescription className="mt-2 text-sm leading-6 text-[var(--muted)]">
            {confirmation === "ACTIVE"
              ? "Mensagens livres serão bloqueadas quando a janela de 24 horas estiver fechada. A retomada usará o modelo aprovado selecionado."
              : "Mensagens livres deixarão de ser bloqueadas pela proteção interna. Use esta opção apenas durante manutenção controlada."}
          </AlertDialogDescription>
          <div className="settings-dialog-actions mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialogCancel asChild><Button disabled={busy} variant="secondary">Cancelar</Button></AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button disabled={busy} onClick={() => { if (confirmation) updateMode(confirmation); }} variant={confirmation === "INACTIVE" ? "danger" : "primary"}>
                {confirmation === "ACTIVE" ? "Ativar proteção" : "Desativar proteção"}
              </Button>
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
