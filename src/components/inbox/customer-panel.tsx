"use client";

import { Phone, Tags, UserRoundCheck } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
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
  pending?: boolean;
}) {
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

  return (
    <div className="p-5">
      <header className="flex items-start gap-3 border-b border-[var(--border)] pb-5">
        <Avatar className="size-12">
          {profilePictureUrl ? <AvatarImage alt="" src={profilePictureUrl} /> : null}
          <AvatarFallback>{initials(conversation.contact.name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--accent)]">XP Atendimento</p>
          <h2 className="mt-1 break-words text-base font-bold text-[var(--text)]">{conversation.contact.name}</h2>
          <p aria-label={`Telefone de ${conversation.contact.name}`} className="mt-1 flex min-w-0 items-start gap-1.5 break-all text-sm text-[var(--muted)]"><Phone aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" /><span>{conversation.contact.phone}</span></p>
        </div>
      </header>

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
    </div>
  );
}
