"use client";

import { LoaderCircle, Tags } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type {
  ContactClassificationDto,
  ContactClassificationRecord,
} from "@/modules/conversations/types";

type ContactTagEditorProps = {
  contactId: string;
  assignedTags: ContactClassificationDto[];
  availableTags: ContactClassificationRecord[];
  loading: boolean;
  pending: boolean;
  error: string | null;
  onRetryLoad: () => void;
  onSave: (contactId: string, tagIds: string[]) => Promise<boolean>;
};

const HEX_COLOR = /^#[0-9A-F]{6}$/i;

function isSafeColor(color: string) {
  return HEX_COLOR.test(color);
}

export function ContactTagEditor({
  contactId,
  assignedTags,
  availableTags,
  loading,
  pending,
  error,
  onRetryLoad,
  onSave,
}: ContactTagEditorProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Set<string>>(() => new Set());
  const [submitting, setSubmitting] = useState(false);
  const submissionPending = useRef(false);
  const availableIds = useMemo(
    () => new Set(availableTags.map((tag) => tag.id)),
    [availableTags],
  );
  const selectionSource = useRef({ assignedTags, availableIds });
  selectionSource.current = { assignedTags, availableIds };
  const unavailableAssigned = assignedTags.filter((tag) => !availableIds.has(tag.id));

  function resetDraft() {
    setDraft(new Set(
      assignedTags.filter((tag) => availableIds.has(tag.id)).map((tag) => tag.id),
    ));
  }

  function changeOpen(nextOpen: boolean) {
    if (nextOpen) resetDraft();
    setOpen(nextOpen);
  }

  useEffect(() => {
    if (open) {
      const source = selectionSource.current;
      setDraft(new Set(
        source.assignedTags
          .filter((tag) => source.availableIds.has(tag.id))
          .map((tag) => tag.id),
      ));
    }
  }, [contactId, open]);

  function toggleTag(tagId: string, checked: boolean) {
    setDraft((current) => {
      const next = new Set(current);
      if (checked) next.add(tagId);
      else next.delete(tagId);
      return next;
    });
  }

  async function save() {
    if (submissionPending.current || pending || loading) return;
    submissionPending.current = true;
    setSubmitting(true);
    try {
      const tagIds = availableTags.filter((tag) => draft.has(tag.id)).map((tag) => tag.id);
      if (await onSave(contactId, tagIds)) setOpen(false);
    } finally {
      submissionPending.current = false;
      setSubmitting(false);
    }
  }

  const saving = pending || submitting;

  return (
    <Dialog onOpenChange={changeOpen} open={open}>
      <DialogTrigger asChild>
        <Button className="w-full justify-start" variant="secondary">
          <Tags aria-hidden="true" className="size-4" />
          Gerenciar etiquetas
        </Button>
      </DialogTrigger>
      <DialogContent aria-describedby="contact-tag-description" className="flex flex-col">
        <DialogTitle className="pr-12 text-lg font-bold text-[var(--text)]">
          Gerenciar etiquetas
        </DialogTitle>
        <DialogDescription className="mt-1 text-sm text-[var(--muted)]" id="contact-tag-description">
          Selecione todas as etiquetas que devem permanecer neste contato.
        </DialogDescription>

        <div className="mt-5 min-h-0 flex-1 overflow-y-auto">
          {unavailableAssigned.length > 0 ? (
            <div className="mb-4 border-l-2 border-[var(--warning)] pl-3 text-sm text-[var(--text)]">
              <p className="font-semibold">Etiqueta indisponível</p>
              <p className="mt-1 font-medium">
                {unavailableAssigned.map((tag) => tag.name).join(", ")}
              </p>
              <p className="mt-1 text-[var(--muted)]">Será removida ao salvar este conjunto.</p>
            </div>
          ) : null}

          {loading ? (
            <p className="flex min-h-11 items-center gap-2 text-sm text-[var(--muted)]" role="status">
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
              Carregando etiquetas
            </p>
          ) : availableTags.length > 0 ? (
            <fieldset className="space-y-1">
              <legend className="sr-only">Etiquetas disponíveis</legend>
              {availableTags.map((tag) => (
                <label
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 text-sm text-[var(--text)] hover:bg-[var(--canvas)]"
                  key={tag.id}
                >
                  <input
                    checked={draft.has(tag.id)}
                    className="size-4 accent-[var(--accent)]"
                    disabled={saving}
                    onChange={(event) => toggleTag(tag.id, event.target.checked)}
                    type="checkbox"
                  />
                  <span
                    aria-hidden="true"
                    className="size-3 shrink-0 rounded-full border border-black/10"
                    style={isSafeColor(tag.color) ? { backgroundColor: tag.color } : undefined}
                  />
                  <span>{tag.displayName}</span>
                </label>
              ))}
            </fieldset>
          ) : (
            <p className="py-3 text-sm text-[var(--muted)]">Nenhuma etiqueta ativa disponível.</p>
          )}

          {error ? (
            <div className="mt-4 border-l-2 border-[var(--danger)] pl-3" role="alert">
              <p className="text-sm text-[var(--text)]">{error}</p>
              {availableTags.length === 0 ? (
                <Button className="mt-2 px-0" onClick={onRetryLoad} size="small" variant="ghost">
                  Tentar novamente
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="mt-5 flex justify-end gap-2 border-t border-[var(--border)] pt-4">
          <DialogClose asChild>
            <Button disabled={saving} variant="secondary">Cancelar</Button>
          </DialogClose>
          <Button
            aria-label={saving ? "Salvando etiquetas" : "Salvar etiquetas"}
            disabled={saving || loading}
            onClick={() => void save()}
          >
            {saving ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> : null}
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
