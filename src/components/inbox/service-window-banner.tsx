"use client";

import { Clock3, LockKeyhole, MessageSquareText } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { formatServiceWindowStatus } from "@/hooks/use-service-window";
import type { ServiceWindowDto } from "@/modules/messaging-policy/types";

const blockedCopy: Record<NonNullable<ServiceWindowDto["reason"]>, string> = {
  CONTACT_OPTED_OUT: "O contato está marcado como não contatar.",
  NO_CUSTOMER_MESSAGE: "A Meta exige uma mensagem anterior do cliente.",
  NO_PENDING_REQUEST: "Não há solicitação pendente para retomar.",
  TEMPLATE_UNAVAILABLE: "O template aprovado não está disponível no momento.",
  WINDOW_EXPIRED: "Aguarde a atualização para verificar a retomada disponível.",
};

export function ServiceWindowBanner({
  serviceWindow,
  onResume,
  pending = false,
  error = null,
}: {
  serviceWindow: ServiceWindowDto;
  onResume: () => Promise<boolean>;
  pending?: boolean;
  error?: string | null;
}) {
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const actionStarted = useRef(false);
  const bannerRef = useRef<HTMLElement>(null);
  const title = formatServiceWindowStatus(serviceWindow);
  const resumption = serviceWindow.resumption;
  const canResume =
    serviceWindow.sendMode === "RESUMPTION" &&
    resumption !== null;
  const busy = pending || submitting;
  const dialogOpen = confirmationOpen && canResume;

  useEffect(() => {
    if (confirmationOpen && !canResume) setConfirmationOpen(false);
  }, [canResume, confirmationOpen]);

  if (!title) return null;

  async function submit() {
    if (!canResume || actionStarted.current || busy) return;
    actionStarted.current = true;
    setSubmitting(true);
    try {
      const resumed = await onResume();
      if (resumed) setConfirmationOpen(false);
    } finally {
      actionStarted.current = false;
      setSubmitting(false);
    }
  }

  return (
    <>
      <section
        aria-label="Janela de atendimento do WhatsApp"
        className="border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--accent)_7%,var(--panel))] px-4 py-3"
        ref={bannerRef}
        tabIndex={-1}
      >
        <div className="flex items-start gap-3">
          {serviceWindow.status === "OPEN" ? (
            <Clock3 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--accent)]" />
          ) : canResume ? (
            <MessageSquareText aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--accent)]" />
          ) : (
            <LockKeyhole aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--muted)]" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-[var(--text)]">{title}</p>
            {canResume ? (
              <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-[var(--muted)]">
                {resumption?.previewBody}
              </p>
            ) : serviceWindow.sendMode === "BLOCKED" && serviceWindow.reason ? (
              <p className="mt-1 text-sm text-[var(--muted)]">{blockedCopy[serviceWindow.reason]}</p>
            ) : null}
            {error && !dialogOpen ? <p className="mt-2 text-sm text-[var(--danger)]" role="alert">{error}</p> : null}
          </div>
          {canResume ? (
            <Button
              className="shrink-0"
              disabled={busy}
              onClick={() => setConfirmationOpen(true)}
              size="small"
            >
              {busy ? "Enviando…" : "Retomar atendimento"}
            </Button>
          ) : null}
        </div>
      </section>

      <AlertDialog
        onOpenChange={(open) => {
          if (!busy) setConfirmationOpen(open);
        }}
        open={dialogOpen}
      >
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            if (!canResume) {
              event.preventDefault();
              bannerRef.current?.focus();
            }
          }}
        >
          <AlertDialogTitle className="text-xl font-bold">
            Enviar template de retomada?
          </AlertDialogTitle>
          <AlertDialogDescription className="mt-2 text-sm leading-6 text-[var(--muted)]">
            A Meta permite este envio fora da janela de 24 horas. Confira o texto final:
          </AlertDialogDescription>
          <p className="mt-4 whitespace-pre-wrap break-words border-l-2 border-[var(--accent)] pl-4 text-sm leading-6 text-[var(--text)]">
            {resumption?.previewBody}
          </p>
          {error ? (
            <p className="mt-3 text-sm text-[var(--danger)]" role="alert">
              {error}
            </p>
          ) : null}
          <div className="mt-6 flex justify-end gap-2">
            <AlertDialogCancel asChild>
              <Button disabled={busy} variant="secondary">Cancelar</Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                disabled={busy}
                onClick={(event) => {
                  event.preventDefault();
                  void submit();
                }}
              >
                {busy ? "Enviando…" : "Enviar template"}
              </Button>
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
