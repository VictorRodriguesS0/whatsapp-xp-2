"use client";

import { ArrowLeft, LogOut, Pencil, Plus, PowerOff, Users, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

export type ContactDefinition = {
  id: string;
  displayName: string;
  color: string;
  position: number;
  active: boolean;
};

type DefinitionKind = "type" | "tag";
type DefinitionDialog =
  | { kind: DefinitionKind; mode: "create" }
  | { kind: DefinitionKind; mode: "edit"; item: ContactDefinition };
type DefinitionTarget = { kind: DefinitionKind; item: ContactDefinition };
type DefinitionValues = Pick<ContactDefinition, "displayName" | "color" | "position">;
type DefinitionPatch = Partial<DefinitionValues>;
type MutationOutcome = "failed" | "refreshed" | "refresh-failed";

const HEX_COLOR = /^#[0-9A-F]{6}$/;

const kindCopy = {
  type: {
    collection: "Tipos de contato",
    create: "Novo tipo",
    createDialog: "Novo tipo de contato",
    createSubmit: "Criar tipo",
    created: "Tipo criado.",
    deactivated: "Tipo de contato desativado.",
    deactivateSubmit: "Desativar tipo",
    empty: "Nenhum tipo de contato cadastrado.",
    endpoint: "/api/settings/contact-types",
    singular: "tipo de contato",
  },
  tag: {
    collection: "Etiquetas",
    create: "Nova etiqueta",
    createDialog: "Nova etiqueta",
    createSubmit: "Criar etiqueta",
    created: "Etiqueta criada.",
    deactivated: "Etiqueta desativada.",
    deactivateSubmit: "Desativar etiqueta",
    empty: "Nenhuma etiqueta cadastrada.",
    endpoint: "/api/settings/contact-tags",
    singular: "etiqueta",
  },
} as const;

function sortDefinitions(items: ContactDefinition[]) {
  return [...items].sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
}

function hasValidColor(color: string) {
  return HEX_COLOR.test(color);
}

function isContactDefinition(value: unknown): value is ContactDefinition {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string"
    && typeof item.displayName === "string"
    && typeof item.color === "string"
    && hasValidColor(item.color)
    && Number.isInteger(item.position)
    && typeof item.active === "boolean";
}

function mutationError(kind: DefinitionKind, status?: number, failure?: "network" | "unexpected") {
  if (failure === "network") return "Sem conexão. Confira sua rede e tente novamente.";
  if (failure === "unexpected") return "Resposta inesperada do servidor. Tente novamente.";
  if (status === 409) return `Já existe ${kind === "type" ? "um tipo de contato" : "uma etiqueta"} com esse nome.`;
  if (status === 404) return `Esse ${kindCopy[kind].singular} não está mais disponível.`;
  if (status === 429) return "Muitas solicitações. Aguarde um momento e tente novamente.";
  return "Não foi possível salvar a alteração.";
}

function parseMutationEnvelope(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const envelope = value as Record<string, unknown>;
  return envelope.error === null && isContactDefinition(envelope.data);
}

function parseCollectionEnvelope(value: unknown): ContactDefinition[] | null {
  if (!value || typeof value !== "object") return null;
  const envelope = value as Record<string, unknown>;
  if (envelope.error !== null || !envelope.data || typeof envelope.data !== "object") return null;
  const items = (envelope.data as Record<string, unknown>).items;
  return Array.isArray(items) && items.every(isContactDefinition) ? sortDefinitions(items) : null;
}

function DefinitionForm({
  busy,
  dialog,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  dialog: DefinitionDialog;
  onCancel(): void;
  onSubmit(values: DefinitionValues | DefinitionPatch): void;
}) {
  const initial = dialog.mode === "edit" ? dialog.item : null;
  const [displayName, setDisplayName] = useState(initial?.displayName ?? "");
  const [color, setColor] = useState(initial?.color ?? "#176B52");
  const [position, setPosition] = useState(String(initial?.position ?? 0));
  const [errors, setErrors] = useState<Partial<Record<"displayName" | "color" | "position", string>>>({});
  const [unchanged, setUnchanged] = useState(false);
  const normalizedColor = color.trim().toUpperCase();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const normalizedName = displayName.trim();
    const numericPosition = Number(position);
    const nextErrors: typeof errors = {};
    if (!normalizedName) nextErrors.displayName = "Informe o nome.";
    if (!HEX_COLOR.test(normalizedColor)) nextErrors.color = "Use uma cor hexadecimal no formato #RRGGBB.";
    if (!Number.isInteger(numericPosition) || numericPosition < 0 || numericPosition > 10_000) {
      nextErrors.position = "Use um número inteiro entre 0 e 10000.";
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const values: DefinitionValues = {
      displayName: normalizedName,
      color: normalizedColor,
      position: numericPosition,
    };
    if (dialog.mode === "create") {
      onSubmit(values);
      return;
    }

    const patch: DefinitionPatch = {};
    if (values.displayName !== dialog.item.displayName.trim()) patch.displayName = values.displayName;
    if (values.color !== dialog.item.color) patch.color = values.color;
    if (values.position !== dialog.item.position) patch.position = values.position;
    if (Object.keys(patch).length === 0) {
      setUnchanged(true);
      return;
    }
    onSubmit(patch);
  }

  const fieldChanged = () => setUnchanged(false);
  const idPrefix = `${dialog.mode}-${dialog.kind}`;
  return (
    <form className="mt-6 space-y-5" noValidate onSubmit={submit}>
      <div>
        <label className="mb-1.5 block text-sm font-semibold" htmlFor={`${idPrefix}-name`}>Nome</label>
        <Input
          aria-describedby={errors.displayName ? `${idPrefix}-name-error` : undefined}
          aria-invalid={Boolean(errors.displayName)}
          autoFocus
          disabled={busy}
          id={`${idPrefix}-name`}
          maxLength={80}
          onChange={(event) => { setDisplayName(event.target.value); fieldChanged(); }}
          value={displayName}
        />
        {errors.displayName ? <p className="mt-1.5 text-sm text-[var(--danger)]" id={`${idPrefix}-name-error`} role="alert">{errors.displayName}</p> : null}
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-semibold" htmlFor={`${idPrefix}-color`}>Cor hexadecimal</label>
        <Input
          aria-describedby={`${idPrefix}-color-value${errors.color ? ` ${idPrefix}-color-error` : ""}`}
          aria-invalid={Boolean(errors.color)}
          disabled={busy}
          id={`${idPrefix}-color`}
          maxLength={7}
          onChange={(event) => { setColor(event.target.value); fieldChanged(); }}
          spellCheck={false}
          value={color}
        />
        <p className="mt-1.5 flex items-center gap-2 text-xs text-[var(--muted)]" id={`${idPrefix}-color-value`}>
          {hasValidColor(normalizedColor) ? <span aria-hidden="true" className="size-3 rounded-full border border-black/10" style={{ backgroundColor: normalizedColor }} /> : null}
          Valor da cor: {normalizedColor || "não informado"}
        </p>
        {errors.color ? <p className="mt-1.5 text-sm text-[var(--danger)]" id={`${idPrefix}-color-error`} role="alert">{errors.color}</p> : null}
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-semibold" htmlFor={`${idPrefix}-position`}>Posição</label>
        <Input
          aria-describedby={errors.position ? `${idPrefix}-position-error` : `${idPrefix}-position-help`}
          aria-invalid={Boolean(errors.position)}
          disabled={busy}
          id={`${idPrefix}-position`}
          inputMode="numeric"
          max={10_000}
          min={0}
          onChange={(event) => { setPosition(event.target.value); fieldChanged(); }}
          type="number"
          value={position}
        />
        <p className="mt-1.5 text-xs text-[var(--muted)]" id={`${idPrefix}-position-help`}>Números menores aparecem primeiro.</p>
        {errors.position ? <p className="mt-1.5 text-sm text-[var(--danger)]" id={`${idPrefix}-position-error`} role="alert">{errors.position}</p> : null}
      </div>
      {unchanged ? <p className="text-sm text-[var(--muted)]" role="status">Nenhuma alteração para salvar.</p> : null}
      <div className="flex flex-col-reverse gap-2 border-t border-[var(--border)] pt-4 sm:flex-row sm:justify-end">
        <Button disabled={busy} onClick={onCancel} variant="secondary">Cancelar</Button>
        <Button disabled={busy} type="submit">
          {busy ? <Spinner className="text-white" label="Salvando" /> : dialog.mode === "create" ? kindCopy[dialog.kind].createSubmit : "Salvar alterações"}
        </Button>
      </div>
    </form>
  );
}

function DefinitionSection({
  busy,
  items,
  kind,
  onCreate,
  onDeactivate,
  onEdit,
}: {
  busy: boolean;
  items: ContactDefinition[];
  kind: DefinitionKind;
  onCreate(event: React.MouseEvent<HTMLButtonElement>): void;
  onDeactivate(item: ContactDefinition, event: React.MouseEvent<HTMLButtonElement>): void;
  onEdit(item: ContactDefinition, event: React.MouseEvent<HTMLButtonElement>): void;
}) {
  const copy = kindCopy[kind];
  const headingId = `${kind}-definitions-heading`;
  return (
    <section aria-labelledby={headingId} className="border-t border-[var(--border)] pt-5" role="region">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold" id={headingId}>{copy.collection}</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">{items.length} {items.length === 1 ? "item" : "itens"}</p>
        </div>
        <Button disabled={busy} onClick={onCreate} variant="secondary"><Plus aria-hidden="true" className="size-4" />{copy.create}</Button>
      </div>
      {items.length === 0 ? (
        <p className="mt-4 border-y border-[var(--border)] bg-[var(--panel)] px-4 py-6 text-sm text-[var(--muted)]">{copy.empty}</p>
      ) : (
        <ul className="mt-4 divide-y divide-[var(--border)] border-y border-[var(--border)] bg-[var(--panel)]">
          {items.map((item) => {
            const validColor = hasValidColor(item.color);
            return (
              <li className="flex min-h-16 flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:px-4" key={item.id}>
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  {validColor ? <span aria-hidden="true" className="size-4 shrink-0 rounded-full border border-black/10" data-testid="color-swatch" style={{ backgroundColor: item.color }} /> : null}
                  <div className="min-w-0">
                    <p className="break-words text-sm font-semibold">{item.displayName}</p>
                    <p className="mt-0.5 text-xs text-[var(--muted)]">{validColor ? item.color : "Cor indisponível"} · posição {item.position}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 sm:justify-end">
                  <Badge className={item.active ? "bg-[var(--selected)] text-[var(--accent)]" : "bg-[var(--canvas)] text-[var(--muted)]"}>{item.active ? "Ativo" : "Inativo"}</Badge>
                  <div className="flex gap-1">
                    <Button aria-label={`Editar ${item.displayName}`} disabled={busy} onClick={(event) => onEdit(item, event)} size="icon" variant="ghost"><Pencil aria-hidden="true" className="size-4" /></Button>
                    {item.active ? <Button aria-label={`Desativar ${item.displayName}`} disabled={busy} onClick={(event) => onDeactivate(item, event)} size="icon" variant="ghost"><PowerOff aria-hidden="true" className="size-4" /></Button> : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function ContactClassificationScreen({
  initialContactTags,
  initialContactTypes,
}: {
  initialContactTags: ContactDefinition[];
  initialContactTypes: ContactDefinition[];
}) {
  const router = useRouter();
  const [types, setTypes] = useState(() => sortDefinitions(initialContactTypes));
  const [tags, setTags] = useState(() => sortDefinitions(initialContactTags));
  const [dialog, setDialog] = useState<DefinitionDialog | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<DefinitionTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const requestSequence = useRef(0);
  const dialogTrigger = useRef<HTMLButtonElement | null>(null);
  const deactivateTrigger = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; requestSequence.current += 1; };
  }, []);

  function notify(message: string) {
    setToast({ id: Date.now(), message });
  }

  function restoreFocus(trigger: RefObject<HTMLButtonElement | null>, event: { preventDefault(): void }) {
    event.preventDefault();
    const element = trigger.current;
    trigger.current = null;
    if (element?.isConnected) element.focus();
  }

  async function readJson(response: Response): Promise<unknown | null> {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  async function refetchCollection(kind: DefinitionKind, sequence: number): Promise<boolean> {
    let response: Response;
    try {
      response = await fetch(kindCopy[kind].endpoint, { cache: "no-store", method: "GET" });
    } catch {
      if (mounted.current && sequence === requestSequence.current) notify(mutationError(kind, undefined, "network"));
      return false;
    }
    if (response.status === 401) {
      try { await Promise.resolve(router.replace("/login?motivo=sessao-expirada")); } catch { /* navigation cancellation is non-fatal */ }
      return false;
    }
    if (!response.ok) {
      if (mounted.current && sequence === requestSequence.current) notify(mutationError(kind, response.status));
      return false;
    }
    const items = parseCollectionEnvelope(await readJson(response));
    if (!items) {
      if (mounted.current && sequence === requestSequence.current) notify(mutationError(kind, undefined, "unexpected"));
      return false;
    }
    if (!mounted.current || sequence !== requestSequence.current) return false;
    if (kind === "type") setTypes(items);
    else setTags(items);
    return true;
  }

  async function mutate(kind: DefinitionKind, url: string, method: "POST" | "PATCH", body: object): Promise<MutationOutcome> {
    if (busyRef.current) return "failed";
    busyRef.current = true;
    const sequence = ++requestSequence.current;
    setBusy(true);
    try {
      let response: Response;
      try {
        response = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch {
        if (mounted.current && sequence === requestSequence.current) notify(mutationError(kind, undefined, "network"));
        return "failed";
      }
      if (response.status === 401) {
        try { await Promise.resolve(router.replace("/login?motivo=sessao-expirada")); } catch { /* navigation cancellation is non-fatal */ }
        return "failed";
      }
      if (!response.ok) {
        if (mounted.current && sequence === requestSequence.current) notify(mutationError(kind, response.status));
        return "failed";
      }
      if (!parseMutationEnvelope(await readJson(response))) {
        if (mounted.current && sequence === requestSequence.current) notify(mutationError(kind, undefined, "unexpected"));
        return "failed";
      }
      return await refetchCollection(kind, sequence) ? "refreshed" : "refresh-failed";
    } finally {
      busyRef.current = false;
      if (mounted.current && sequence === requestSequence.current) setBusy(false);
    }
  }

  async function submitDefinition(values: DefinitionValues | DefinitionPatch) {
    if (!dialog) return;
    const currentDialog = dialog;
    const copy = kindCopy[currentDialog.kind];
    const outcome = await mutate(
      currentDialog.kind,
      currentDialog.mode === "create" ? copy.endpoint : `${copy.endpoint}/${currentDialog.item.id}`,
      currentDialog.mode === "create" ? "POST" : "PATCH",
      values,
    );
    if (outcome === "failed" || !mounted.current) return;
    setDialog(null);
    const successMessage = currentDialog.mode === "create" ? copy.created : "Alterações salvas.";
    notify(outcome === "refresh-failed"
      ? `${successMessage.slice(0, -1)}, mas a lista não pôde ser atualizada. Atualize a página para conferir.`
      : successMessage);
  }

  async function deactivate() {
    if (!deactivateTarget) return;
    const target = deactivateTarget;
    const copy = kindCopy[target.kind];
    const outcome = await mutate(target.kind, `${copy.endpoint}/${target.item.id}`, "PATCH", { active: false });
    if (outcome === "failed" || !mounted.current) return;
    setDeactivateTarget(null);
    notify(outcome === "refresh-failed"
      ? `${copy.deactivated.slice(0, -1)}, mas a lista não pôde ser atualizada. Atualize a página para conferir.`
      : copy.deactivated);
  }

  async function logout() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      try { await fetch("/api/auth/logout", { method: "POST" }); } catch { /* local navigation remains available */ }
      try { await Promise.resolve(router.replace("/login")); } catch { /* navigation cancellation is non-fatal */ }
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function openDialog(nextDialog: DefinitionDialog, trigger: HTMLButtonElement) {
    setToast(null);
    dialogTrigger.current = trigger;
    setDialog(nextDialog);
  }

  function openDeactivation(target: DefinitionTarget, trigger: HTMLButtonElement) {
    setToast(null);
    deactivateTrigger.current = trigger;
    setDeactivateTarget(target);
  }

  function closeDialog() {
    if (busy) return;
    setToast(null);
    setDialog(null);
  }

  function closeDeactivation() {
    if (busy) return;
    setToast(null);
    setDeactivateTarget(null);
  }

  const dialogClasses = "inset-auto bottom-auto right-auto left-1/2 top-1/2 max-h-[calc(100dvh-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border shadow-[0_16px_48px_rgba(32,37,34,0.14)]";

  return (
    <>
    <main aria-labelledby="classification-heading" className="min-h-dvh overflow-x-hidden bg-[var(--canvas)] px-4 py-5 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-5xl">
        <header className="flex flex-col gap-4 border-b border-[var(--border)] pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <a className="inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-semibold text-[var(--muted)] outline-none hover:text-[var(--text)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]" href="/conversas"><ArrowLeft aria-hidden="true" className="size-4" />Conversas</a>
            <p className="mt-3 text-xs font-bold uppercase tracking-[0.12em] text-[var(--accent)]">Configurações</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight" id="classification-heading">Classificação do atendimento</h1>
            <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">Organize os tipos e as etiquetas usados nos contatos.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="secondary"><a href="/configuracoes/usuarios"><Users aria-hidden="true" className="size-4" />Usuários</a></Button>
            <Button disabled={busy} onClick={() => void logout()} variant="secondary"><LogOut aria-hidden="true" className="size-4" />Sair</Button>
          </div>
        </header>

        <div className="mt-6 space-y-8">
          <DefinitionSection
            busy={busy}
            items={types}
            kind="type"
            onCreate={(event) => openDialog({ kind: "type", mode: "create" }, event.currentTarget)}
            onDeactivate={(item, event) => openDeactivation({ item, kind: "type" }, event.currentTarget)}
            onEdit={(item, event) => openDialog({ item, kind: "type", mode: "edit" }, event.currentTarget)}
          />
          <DefinitionSection
            busy={busy}
            items={tags}
            kind="tag"
            onCreate={(event) => openDialog({ kind: "tag", mode: "create" }, event.currentTarget)}
            onDeactivate={(item, event) => openDeactivation({ item, kind: "tag" }, event.currentTarget)}
            onEdit={(item, event) => openDialog({ item, kind: "tag", mode: "edit" }, event.currentTarget)}
          />
        </div>
      </div>
    </main>

      <Dialog onOpenChange={(open) => { if (!open) closeDialog(); }} open={Boolean(dialog)}>
        <DialogContent className={dialogClasses} onCloseAutoFocus={(event) => restoreFocus(dialogTrigger, event)}>
          <DialogTitle className="pr-12 text-xl font-bold">{dialog?.mode === "create" ? kindCopy[dialog.kind].createDialog : `Editar ${dialog ? kindCopy[dialog.kind].singular : "classificação"}`}</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-[var(--muted)]">Defina nome, cor e ordem de exibição.</DialogDescription>
          {toast ? (
            <div className="mt-4 flex items-center gap-2 border-l-4 border-[var(--danger)] bg-[var(--canvas)] py-1 pl-3 pr-1 text-sm font-semibold" role="alert">
              <span>{toast.message}</span>
              <Button aria-label="Fechar aviso" className="ml-auto" onClick={() => setToast(null)} size="icon" variant="ghost"><X aria-hidden="true" className="size-4" /></Button>
            </div>
          ) : null}
          {dialog ? <DefinitionForm busy={busy} dialog={dialog} key={dialog.mode === "edit" ? dialog.item.id : `${dialog.kind}-create`} onCancel={closeDialog} onSubmit={(values) => void submitDefinition(values)} /> : null}
        </DialogContent>
      </Dialog>

      <AlertDialog onOpenChange={(open) => { if (!open) closeDeactivation(); }} open={Boolean(deactivateTarget)}>
        <AlertDialogContent onCloseAutoFocus={(event) => restoreFocus(deactivateTrigger, event)}>
          <AlertDialogTitle className="text-xl font-bold">Desativar {deactivateTarget ? kindCopy[deactivateTarget.kind].singular : "classificação"}?</AlertDialogTitle>
          <AlertDialogDescription className="mt-2 text-sm leading-6 text-[var(--muted)]">{deactivateTarget?.item.displayName ?? "O item"} deixará de aparecer em novas classificações. O histórico será preservado.</AlertDialogDescription>
          {toast ? (
            <div className="mt-4 flex items-center gap-2 border-l-4 border-[var(--danger)] bg-[var(--canvas)] py-1 pl-3 pr-1 text-sm font-semibold" role="alert">
              <span>{toast.message}</span>
              <Button aria-label="Fechar aviso" className="ml-auto" onClick={() => setToast(null)} size="icon" variant="ghost"><X aria-hidden="true" className="size-4" /></Button>
            </div>
          ) : null}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialogCancel asChild><Button disabled={busy} variant="secondary">Cancelar</Button></AlertDialogCancel>
            <AlertDialogAction asChild><Button data-confirm disabled={busy} onClick={() => void deactivate()} variant="danger">{busy ? "Salvando…" : deactivateTarget ? kindCopy[deactivateTarget.kind].deactivateSubmit : "Desativar"}</Button></AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>

      {toast && !dialog && !deactivateTarget ? (
        <div aria-atomic="true" aria-live="polite" className="fixed bottom-4 left-4 right-4 z-[60] flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--panel)] py-1 pl-4 pr-1 text-sm font-semibold shadow-[0_12px_32px_rgba(32,37,34,0.12)] sm:left-auto sm:max-w-sm" key={toast.id} role="status">
          <span>{toast.message}</span>
          <Button aria-label="Fechar aviso" onClick={() => setToast(null)} size="icon" variant="ghost"><X aria-hidden="true" className="size-4" /></Button>
        </div>
      ) : null}
    </>
  );
}
