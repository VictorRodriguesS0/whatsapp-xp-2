"use client";

import { BadgeCheck, MessageCircleMore } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ContactMessagingConsentSource } from "@/generated/prisma/enums";
import type { ContactMessagingConsentInput } from "@/modules/contacts/schemas";
import type { ContactMessagingConsentDto } from "@/modules/contacts/types";

const sourceLabels: Record<ContactMessagingConsentSource, string> = {
  [ContactMessagingConsentSource.WHATSAPP]: "WhatsApp",
  [ContactMessagingConsentSource.LOJA_FISICA]: "Loja física",
  [ContactMessagingConsentSource.TELEFONE]: "Telefone",
  [ContactMessagingConsentSource.OUTRO]: "Outro",
};

const consentDate = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});

type ContactConsentControlProps = {
  contactId: string;
  consent: ContactMessagingConsentDto;
  messagingRestricted?: boolean;
  pending?: boolean;
  error?: string | null;
  onChange: (
    contactId: string,
    input: ContactMessagingConsentInput,
  ) => Promise<boolean>;
};

export function ContactConsentControl({
  contactId,
  consent,
  messagingRestricted = false,
  pending = false,
  error = null,
  onChange,
}: ContactConsentControlProps) {
  const [intent, setIntent] = useState<"GRANT" | "REVOKE" | null>(null);
  const [source, setSource] = useState<ContactMessagingConsentSource>(
    ContactMessagingConsentSource.WHATSAPP,
  );
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const busy = pending || submitting;
  const requiresNote = source === ContactMessagingConsentSource.OUTRO;
  const validGrant = !requiresNote || note.trim().length >= 3;

  useEffect(() => {
    setIntent(null);
    setSource(ContactMessagingConsentSource.WHATSAPP);
    setNote("");
    setSubmitting(false);
  }, [contactId]);

  function closeDialog() {
    if (busy) return;
    setIntent(null);
    setSource(ContactMessagingConsentSource.WHATSAPP);
    setNote("");
  }

  async function submit() {
    if (!intent || busy || (intent === "GRANT" && !validGrant)) return;
    setSubmitting(true);
    try {
      let input: ContactMessagingConsentInput;
      if (intent === "REVOKE") {
        input = { action: "REVOKE" };
      } else {
        const trimmedNote = note.trim();
        input = {
          action: "GRANT",
          source,
          ...(source === ContactMessagingConsentSource.OUTRO
            ? { note: trimmedNote }
            : {}),
        };
      }
      if (await onChange(contactId, input)) {
        setIntent(null);
        setSource(ContactMessagingConsentSource.WHATSAPP);
        setNote("");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section
      aria-labelledby="contact-consent-heading"
      className="border-b border-[var(--border)] py-5"
    >
      <h3
        className="flex items-center gap-2 text-sm font-bold text-[var(--text)]"
        id="contact-consent-heading"
      >
        {consent.active ? (
          <BadgeCheck aria-hidden="true" className="size-4 text-[var(--accent)]" />
        ) : (
          <MessageCircleMore aria-hidden="true" className="size-4" />
        )}
        Autorização de mensagens
      </h3>

      {consent.active && consent.grantedAt && consent.grantedBy && consent.source ? (
        <div className="mt-3 border-l-2 border-[var(--accent)] pl-3">
          <p className="text-sm font-semibold text-[var(--text)]">
            Autorizado em {consentDate.format(new Date(consent.grantedAt))} por{" "}
            {consent.grantedBy.name}
          </p>
          <p className="mt-1 flex flex-wrap gap-1 text-xs leading-5 text-[var(--muted)]">
            <span>Origem:</span>
            <span>{sourceLabels[consent.source]}</span>
          </p>
          {consent.note ? (
            <p className="mt-1 break-words text-xs leading-5 text-[var(--muted)]">
              {consent.note}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="mt-3">
          <p className="text-sm font-semibold text-[var(--text)]">
            Sem autorização registrada
          </p>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
            Registre somente quando o contato autorizar mensagens da loja.
          </p>
        </div>
      )}

      {messagingRestricted && !consent.active ? (
        <p className="mt-3 text-xs leading-5 text-[var(--danger)]">
          Remova primeiro a restrição “não contatar”.
        </p>
      ) : null}

      <Button
        className="mt-4 w-full"
        disabled={busy || (messagingRestricted && !consent.active)}
        onClick={(event) => {
          triggerRef.current = event.currentTarget;
          setSource(ContactMessagingConsentSource.WHATSAPP);
          setNote("");
          setIntent(consent.active ? "REVOKE" : "GRANT");
        }}
        variant={consent.active ? "secondary" : "primary"}
      >
        {consent.active ? "Revogar autorização" : "Registrar autorização"}
      </Button>
      {error && intent === null ? (
        <p className="mt-2 text-sm text-[var(--danger)]" role="alert">
          {error}
        </p>
      ) : null}

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
        open={intent !== null}
      >
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            triggerRef.current?.focus();
          }}
        >
          <AlertDialogTitle className="text-xl font-bold">
            {intent === "REVOKE"
              ? "Revogar autorização?"
              : "Registrar autorização de mensagens"}
          </AlertDialogTitle>
          <AlertDialogDescription className="mt-2 text-sm leading-6 text-[var(--muted)]">
            {intent === "REVOKE"
              ? "A autorização atual será encerrada e permanecerá registrada no histórico."
              : "Confirme como o contato autorizou a loja a enviar mensagens pelo WhatsApp."}
          </AlertDialogDescription>

          {intent === "GRANT" ? (
            <div className="mt-4 min-w-0">
              <label
                className="block text-sm font-semibold text-[var(--text)]"
                id="contact-consent-source-label"
              >
                Origem da autorização
              </label>
              <Select
                disabled={busy}
                onValueChange={(value) => {
                  setSource(value as ContactMessagingConsentSource);
                  setNote("");
                }}
                value={source}
              >
                <SelectTrigger
                  aria-label="Origem da autorização"
                  className="mt-1 min-w-0"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(ContactMessagingConsentSource).map((value) => (
                    <SelectItem key={value} value={value}>
                      {sourceLabels[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {requiresNote ? (
                <div className="mt-4">
                  <label
                    className="block text-sm font-semibold text-[var(--text)]"
                    htmlFor="contact-consent-note"
                  >
                    Como a autorização foi obtida
                  </label>
                  <Input
                    aria-label="Como a autorização foi obtida"
                    autoFocus
                    disabled={busy}
                    id="contact-consent-note"
                    maxLength={240}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="Ex.: autorização durante evento da loja"
                    value={note}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <p className="mt-3 text-sm text-[var(--danger)]" role="alert">
              {error}
            </p>
          ) : null}

          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialogCancel asChild>
              <Button className="w-full sm:w-auto" disabled={busy} variant="secondary">
                Cancelar
              </Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                className="w-full sm:w-auto"
                disabled={busy || (intent === "GRANT" && !validGrant)}
                onClick={(event) => {
                  event.preventDefault();
                  void submit();
                }}
                variant={intent === "REVOKE" ? "danger" : "primary"}
              >
                {busy
                  ? "Salvando…"
                  : intent === "REVOKE"
                    ? "Confirmar revogação"
                    : "Confirmar autorização"}
              </Button>
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
