"use client";

import { Phone, UserRoundCheck } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ResponsibleOption } from "@/hooks/use-inbox";
import type { ConversationListItem } from "@/modules/conversations/types";

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

export function CustomerPanel({
  conversation,
  users,
  currentUserId,
  onSetResponsible,
}: {
  conversation: ConversationListItem | null;
  users: ResponsibleOption[];
  currentUserId: string;
  onSetResponsible: (userId: string | null) => void;
}) {
  if (!conversation) {
    return <div className="p-5 text-sm text-[var(--muted)]">Selecione uma conversa para ver os dados do cliente.</div>;
  }

  const responsibleOptions = conversation.responsible && !users.some((user) => user.id === conversation.responsible?.id)
    ? [...users, { ...conversation.responsible, active: true }]
    : users;

  return (
    <div className="p-5">
      <div className="flex items-center gap-3 border-b border-[var(--border)] pb-5">
        <Avatar className="size-12">
          {conversation.contact.profilePictureUrl ? <AvatarImage alt="" src={conversation.contact.profilePictureUrl} /> : null}
          <AvatarFallback>{initials(conversation.contact.name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <h2 className="truncate text-base font-bold text-[var(--text)]">{conversation.contact.name}</h2>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-[var(--muted)]"><Phone aria-hidden="true" className="size-3.5" />{conversation.contact.phone}</p>
        </div>
      </div>

      <section aria-labelledby="responsible-heading" className="pt-5">
        <h3 className="flex items-center gap-2 text-sm font-bold text-[var(--text)]" id="responsible-heading"><UserRoundCheck aria-hidden="true" className="size-4" />Responsável</h3>
        <p className="mt-1 text-sm text-[var(--muted)]">{conversation.responsible?.name ?? "Sem responsável"}</p>

        <label className="mt-4 block text-xs font-semibold text-[var(--muted)]" id="responsible-select-label">Trocar responsável</label>
        <Select
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
          {conversation.responsible?.id !== currentUserId ? <Button onClick={() => onSetResponsible(currentUserId)} size="small">Assumir conversa</Button> : null}
          {conversation.responsible ? <Button onClick={() => onSetResponsible(null)} size="small" variant="secondary">Remover responsável</Button> : null}
        </div>
      </section>
    </div>
  );
}
