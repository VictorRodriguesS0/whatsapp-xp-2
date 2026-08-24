"use client";

import { Ban, Phone, ShieldCheck, Tags, UserRoundCheck } from "lucide-react";
import { useEffect, useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ResponsibleOption } from "@/hooks/use-inbox";
import type { ContactClassificationRecord, ConversationListItem } from "@/modules/conversations/types";

import { ContactTagChip } from "./contact-tag-chip";
import { ContactTagEditor } from "./contact-tag-editor";
import { ContactTypeSelector } from "./contact-type-selector";

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

export function CustomerPanel({
  conversation,
  users,
  currentUserId,
  onSetResponsible,
  availableTypes,
  typesLoading,
  typesError,
  typeSavePending,
  typeSaveError,
  onRetryTypes,
  onSetContactType,
  availableTags,
  tagsLoading,
  tagsError,
  tagSavePending,
  tagSaveError,
  onRetryTags,
  onSaveTags,
  onSetMessagingRestriction,
  messagingRestrictionPending = false,
  messagingRestrictionError = null,
  pending = false,
}: {
  conversation: ConversationListItem | null;
  users: ResponsibleOption[];
  currentUserId: string;
  onSetResponsible: (userId: string | null) => void;
  availableTypes: ContactClassificationRecord[];
  typesLoading: boolean;
  typesError: string | null;
  typeSavePending: boolean;
  typeSaveError: string | null;
  onRetryTypes: () => void;
  onSetContactType: (
    contactId: string,
    contactTypeId: string | null,
  ) => Promise<boolean>;
  availableTags: ContactClassificationRecord[];
  tagsLoading: boolean;
  tagsError: string | null;
  tagSavePending: boolean;
  tagSaveError: string | null;
  onRetryTags: () => void;
  onSaveTags: (contactId: string, tagIds: string[]) => Promise<boolean>;
  onSetMessagingRestriction?: (
    contactId: string,
    restricted: boolean,
    reason: string,
  ) => Promise<boolean>;
  messagingRestrictionPending?: boolean;
  messagingRestrictionError?: string | null;
  pending?: boolean;
}) {
  const [restrictionIntent, setRestrictionIntent] = useState<boolean | null>(null);
  const [restrictionReason, setRestrictionReason] = useState("");
  const [restrictionSubmitting, setRestrictionSubmitting] = useState(false);

  useEffect(() => {
    setRestrictionIntent(null);
    setRestrictionReason("");
    setRestrictionSubmitting(false);
  }, [conversation?.contact.id]);

  if (!conversation) {
    return <div className="p-5 text-sm text-[var(--muted)]">Selecione uma conversa para ver os dados do cliente.</div>;
  }

  const responsibleOptions = conversation.responsible && !users.some((user) => user.id === conversation.responsible?.id)
    ? [...users, { ...conversation.responsible, active: true }]
    : users;
  const profilePictureUrl = (
    conversation.contact as typeof conversation.contact & {
      profilePictureUrl?: string | null;
    }
  ).profilePictureUrl;
  const restrictionBusy =
    messagingRestrictionPending || restrictionSubmitting;
  const contactId = conversation.contact.id;

  async function submitRestriction() {
    if (
      restrictionIntent === null ||
      restrictionReason.trim().length < 3 ||
      restrictionBusy ||
      !onSetMessagingRestriction
    ) return;
    setRestrictionSubmitting(true);
    try {
      const saved = await onSetMessagingRestriction(
        contactId,
        restrictionIntent,
        restrictionReason.trim(),
      );
      if (saved) {
        setRestrictionIntent(null);
        setRestrictionReason("");
      }
    } finally {
      setRestrictionSubmitting(false);
    }
  }

  return (
    <div className="p-5">
      <div className="flex items-center gap-3 border-b border-[var(--border)] pb-5">
        <Avatar className="size-12">
          {profilePictureUrl ? <AvatarImage alt="" src={profilePictureUrl} /> : null}
          <AvatarFallback>{initials(conversation.contact.name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <h2 className="truncate text-base font-bold text-[var(--text)]">{conversation.contact.name}</h2>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-[var(--muted)]"><Phone aria-hidden="true" className="size-3.5" />{conversation.contact.phone}</p>
        </div>
      </div>

      <ContactTypeSelector
        availableTypes={availableTypes}
        contactId={conversation.contact.id}
        currentType={conversation.contact.type}
        loadError={typesError}
        loading={typesLoading}
        onChange={onSetContactType}
        onRetryLoad={onRetryTypes}
        pending={typeSavePending}
        saveError={typeSaveError}
      />

      <section aria-labelledby="contact-tags-heading" className="border-b border-[var(--border)] py-5">
        <h3 className="flex items-center gap-2 text-sm font-bold text-[var(--text)]" id="contact-tags-heading">
          <Tags aria-hidden="true" className="size-4" />
          Etiquetas
        </h3>
        {conversation.contact.tags.length > 0 ? (
          <div aria-label={`Etiquetas de ${conversation.contact.name}`} className="mt-3 flex flex-wrap gap-2">
            {conversation.contact.tags.map((tag) => (
              <ContactTagChip color={tag.color} key={tag.id} name={tag.name} />
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-[var(--muted)]">Nenhuma etiqueta aplicada</p>
        )}
        <div className="mt-4">
          <ContactTagEditor
            assignedTags={conversation.contact.tags}
            availableTags={availableTags}
            contactId={conversation.contact.id}
            error={tagSaveError ?? tagsError}
            key={conversation.contact.id}
            loading={tagsLoading}
            onRetryLoad={onRetryTags}
            onSave={onSaveTags}
            pending={tagSavePending}
          />
        </div>
      </section>

      {onSetMessagingRestriction ? (
        <section aria-labelledby="contact-permission-heading" className="border-b border-[var(--border)] py-5">
          <h3 className="flex items-center gap-2 text-sm font-bold text-[var(--text)]" id="contact-permission-heading">
            {conversation.contact.messagingRestricted ? (
              <Ban aria-hidden="true" className="size-4 text-[var(--danger)]" />
            ) : (
              <ShieldCheck aria-hidden="true" className="size-4" />
            )}
            Preferência de contato
          </h3>
          {conversation.contact.messagingRestricted ? (
            <div className="mt-3 border-l-2 border-[var(--danger)] pl-3">
              <p className="text-sm font-semibold text-[var(--text)]">
                Este contato está marcado como não contatar.
              </p>
              <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                Novas retomadas ficam bloqueadas até uma autorização explícita.
              </p>
            </div>
          ) : (
            <p className="mt-2 text-sm leading-5 text-[var(--muted)]">
              Registre aqui apenas uma solicitação explícita do cliente.
            </p>
          )}
          <Button
            className="mt-4 w-full"
            disabled={restrictionBusy}
            onClick={() => {
              setRestrictionReason("");
              setRestrictionIntent(!conversation.contact.messagingRestricted);
            }}
            variant={conversation.contact.messagingRestricted ? "secondary" : "danger"}
          >
            {conversation.contact.messagingRestricted
              ? "Permitir contato novamente"
              : "Não contatar"}
          </Button>
          {messagingRestrictionError && restrictionIntent === null ? (
            <p className="mt-2 text-sm text-[var(--danger)]" role="alert">
              {messagingRestrictionError}
            </p>
          ) : null}
        </section>
      ) : null}

      <section aria-labelledby="responsible-heading" className="pt-5">
        <h3 className="flex items-center gap-2 text-sm font-bold text-[var(--text)]" id="responsible-heading"><UserRoundCheck aria-hidden="true" className="size-4" />Responsável</h3>
        <p className="mt-1 text-sm text-[var(--muted)]">{conversation.responsible?.name ?? "Sem responsável"}</p>

        <label className="mt-4 block text-xs font-semibold text-[var(--muted)]" id="responsible-select-label">Trocar responsável</label>
        <Select
          disabled={pending}
          onValueChange={(value) => onSetResponsible(value === "none" ? null : value)}
          value={conversation.responsible?.id ?? "none"}
        >
          <SelectTrigger aria-labelledby="responsible-select-label" className="mt-1">
            <SelectValue placeholder="Selecione" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Sem responsável</SelectItem>
            {responsibleOptions.map((user) => <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>)}
          </SelectContent>
        </Select>

        <div className="mt-3 flex flex-wrap gap-2">
          {conversation.responsible?.id !== currentUserId ? <Button disabled={pending} onClick={() => onSetResponsible(currentUserId)} size="small">Assumir conversa</Button> : null}
          {conversation.responsible ? <Button disabled={pending} onClick={() => onSetResponsible(null)} size="small" variant="secondary">Remover responsável</Button> : null}
        </div>
        {pending ? <p className="mt-2 text-xs text-[var(--muted)]" role="status">Atualizando responsável</p> : null}
      </section>

      <AlertDialog
        onOpenChange={(open) => {
          if (!open && !restrictionBusy) {
            setRestrictionIntent(null);
            setRestrictionReason("");
          }
        }}
        open={restrictionIntent !== null}
      >
        <AlertDialogContent>
          <AlertDialogTitle className="text-xl font-bold">
            {restrictionIntent ? "Marcar como não contatar?" : "Permitir contato novamente?"}
          </AlertDialogTitle>
          <AlertDialogDescription className="mt-2 text-sm leading-6 text-[var(--muted)]">
            {restrictionIntent
              ? "A retomada por template será bloqueada para este contato."
              : "A permissão vale para atendimentos futuros que respeitem as regras da Meta."}
          </AlertDialogDescription>
          <label className="mt-4 block text-sm font-semibold text-[var(--text)]" htmlFor="messaging-restriction-reason">
            Motivo
          </label>
          <Input
            aria-label="Motivo"
            autoFocus
            id="messaging-restriction-reason"
            maxLength={240}
            onChange={(event) => setRestrictionReason(event.target.value)}
            placeholder={restrictionIntent ? "Ex.: cliente solicitou não receber mensagens" : "Ex.: cliente autorizou novo contato"}
            value={restrictionReason}
          />
          {messagingRestrictionError ? (
            <p className="mt-3 text-sm text-[var(--danger)]" role="alert">
              {messagingRestrictionError}
            </p>
          ) : null}
          <div className="mt-6 flex justify-end gap-2">
            <AlertDialogCancel asChild>
              <Button disabled={restrictionBusy} variant="secondary">Cancelar</Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                disabled={restrictionBusy || restrictionReason.trim().length < 3}
                onClick={(event) => {
                  event.preventDefault();
                  void submitRestriction();
                }}
                variant={restrictionIntent ? "danger" : "primary"}
              >
                {restrictionBusy
                  ? "Salvando…"
                  : restrictionIntent
                    ? "Confirmar restrição"
                    : "Confirmar permissão"}
              </Button>
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
