"use client";

import { ContactRound } from "lucide-react";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  ContactClassificationDto,
  ContactClassificationRecord,
} from "@/modules/conversations/types";

import { ContactTypeChip } from "./contact-type-chip";

export function ContactTypeSelector({
  contactId,
  currentType,
  availableTypes,
  loading,
  loadError,
  pending,
  saveError,
  onRetryLoad,
  onChange,
}: {
  contactId: string;
  currentType: ContactClassificationDto | null;
  availableTypes: ContactClassificationRecord[];
  loading: boolean;
  loadError: string | null;
  pending: boolean;
  saveError: string | null;
  onRetryLoad: () => void;
  onChange: (contactId: string, contactTypeId: string | null) => Promise<boolean>;
}) {
  const headingId = useId();
  const selectLabelId = useId();
  const inactiveCurrent = currentType && !availableTypes.some(({ id }) => id === currentType.id)
    ? currentType
    : null;

  return (
    <section aria-labelledby={headingId} className="border-b border-[var(--border)] py-5">
      <h3 className="flex items-center gap-2 text-sm font-bold text-[var(--text)]" id={headingId}>
        <ContactRound aria-hidden="true" className="size-4" />
        Tipo de contato
      </h3>
      <div className="mt-3">
        {currentType
          ? <ContactTypeChip color={currentType.color} name={currentType.name} />
          : <span className="text-sm text-[var(--muted)]">Sem tipo</span>}
      </div>
      <label className="mt-4 block text-xs font-semibold text-[var(--muted)]" id={selectLabelId}>
        Tipo de contato
      </label>
      <Select
        disabled={loading || pending || Boolean(loadError)}
        onValueChange={(value) => void onChange(contactId, value === "none" ? null : value)}
        value={currentType?.id ?? "none"}
      >
        <SelectTrigger aria-labelledby={selectLabelId} className="mt-1 min-h-11">
          <SelectValue placeholder="Selecione" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Sem tipo</SelectItem>
          {availableTypes.map((type) => (
            <SelectItem key={type.id} value={type.id}>{type.displayName}</SelectItem>
          ))}
          {inactiveCurrent ? (
            <SelectItem disabled value={inactiveCurrent.id}>
              {inactiveCurrent.name} (inativo)
            </SelectItem>
          ) : null}
        </SelectContent>
      </Select>
      {pending ? (
        <p className="mt-2 text-xs text-[var(--muted)]" role="status">
          Atualizando tipo de contato
        </p>
      ) : null}
      {loadError ? (
        <div className="mt-2" role="alert">
          <p className="text-sm text-[var(--danger)]">{loadError}</p>
          <Button className="mt-2" onClick={onRetryLoad} size="small" variant="secondary">
            Tentar novamente
          </Button>
        </div>
      ) : null}
      {saveError ? (
        <p className="mt-2 text-sm text-[var(--danger)]" role="alert">{saveError}</p>
      ) : null}
    </section>
  );
}
