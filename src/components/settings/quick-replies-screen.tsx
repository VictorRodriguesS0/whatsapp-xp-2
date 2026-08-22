"use client";

import { ArrowLeft, Pencil, Plus, Power, PowerOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { QuickReplyDto } from "@/modules/quick-replies/service";

function sort(items: QuickReplyDto[]) {
  return [...items].sort((a, b) => a.position - b.position || a.shortcut.localeCompare(b.shortcut));
}

function isReply(value: unknown): value is QuickReplyDto {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string" && typeof item.shortcut === "string" && typeof item.message === "string" && typeof item.position === "number" && typeof item.active === "boolean";
}

export function QuickRepliesScreen({ initialQuickReplies }: { initialQuickReplies: QuickReplyDto[] }) {
  const router = useRouter();
  const [items, setItems] = useState(() => sort(initialQuickReplies));
  const [editing, setEditing] = useState<QuickReplyDto | "new" | null>(null);
  const [shortcut, setShortcut] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open(item: QuickReplyDto | "new") {
    setEditing(item);
    setShortcut(item === "new" ? "" : item.shortcut);
    setMessage(item === "new" ? "" : item.message);
    setError(null);
  }

  function merge(item: QuickReplyDto) {
    setItems((current) => sort(current.some((entry) => entry.id === item.id) ? current.map((entry) => entry.id === item.id ? item : entry) : [...current, item]));
  }

  async function mutate(url: string, method: "POST" | "PATCH", body: object): Promise<QuickReplyDto | null> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (response.status === 401) { router.replace("/login?motivo=sessao-expirada"); return null; }
      const payload = await response.json().catch(() => null) as { data?: unknown; error?: { message?: string } } | null;
      if (!response.ok) { setError(payload?.error?.message ?? "Não foi possível salvar a resposta rápida."); return null; }
      if (!isReply(payload?.data)) { setError("Resposta inesperada do servidor."); return null; }
      return payload.data;
    } catch {
      setError("Sem conexão. Confira sua rede e tente novamente.");
      return null;
    } finally { setBusy(false); }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!editing) return;
    const result = editing === "new"
      ? await mutate("/api/quick-replies", "POST", { shortcut, message })
      : await mutate(`/api/quick-replies/${editing.id}`, "PATCH", { shortcut, message });
    if (!result) return;
    merge(result);
    setEditing(null);
  }

  async function toggle(item: QuickReplyDto) {
    const result = await mutate(`/api/quick-replies/${item.id}`, "PATCH", { active: !item.active });
    if (result) merge(result);
  }

  const dialogClass = "inset-auto bottom-auto right-auto left-1/2 top-1/2 max-h-[calc(100dvh-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border shadow-[0_16px_48px_rgba(32,37,34,0.14)]";
  return (
    <main aria-labelledby="quick-replies-heading" className="min-h-dvh bg-[var(--canvas)] px-4 py-5 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-5xl">
        <header className="flex flex-col gap-4 border-b border-[var(--border)] pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <a className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[var(--muted)]" href="/conversas"><ArrowLeft className="size-4" />Conversas</a>
            <p className="mt-3 text-xs font-bold uppercase tracking-[0.12em] text-[var(--accent)]">Configurações</p>
            <h1 className="mt-1 text-2xl font-bold" id="quick-replies-heading">Respostas rápidas</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">Atalhos compartilhados por toda a equipe.</p>
          </div>
          <Button disabled={busy} onClick={() => open("new")}><Plus className="size-4" />Nova resposta</Button>
        </header>
        {error && !editing ? <p className="mt-4 rounded-md border border-[var(--danger)] p-3 text-sm text-[var(--danger)]" role="alert">{error}</p> : null}
        <section className="mt-6 space-y-3" aria-label="Catálogo de respostas rápidas">
          {items.length === 0 ? <p className="rounded-md border border-dashed border-[var(--border)] p-8 text-center text-sm text-[var(--muted)]">Nenhuma resposta rápida cadastrada.</p> : items.map((item) => (
            <article className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4" key={item.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><div className="flex items-center gap-2"><strong className="text-[var(--accent)]">/{item.shortcut}</strong><Badge>{item.active ? "Ativa" : "Inativa"}</Badge></div><p className="mt-2 whitespace-pre-wrap text-sm">{item.message}</p></div>
                <div className="flex shrink-0 gap-1">
                  <Button aria-label={`Editar /${item.shortcut}`} disabled={busy} onClick={() => open(item)} size="icon" variant="ghost"><Pencil className="size-4" /></Button>
                  <Button aria-label={`${item.active ? "Desativar" : "Ativar"} /${item.shortcut}`} disabled={busy} onClick={() => void toggle(item)} size="icon" variant="ghost">{item.active ? <PowerOff className="size-4" /> : <Power className="size-4" />}</Button>
                </div>
              </div>
            </article>
          ))}
        </section>
      </div>
      <Dialog onOpenChange={(value) => { if (!value && !busy) setEditing(null); }} open={editing !== null}>
        <DialogContent className={dialogClass}>
          <DialogTitle className="pr-12 text-xl font-bold">{editing === "new" ? "Nova resposta rápida" : "Editar resposta rápida"}</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-[var(--muted)]">O atalho será usado depois de digitar / no atendimento.</DialogDescription>
          <form className="mt-5 space-y-4" onSubmit={(event) => void submit(event)}>
            <label className="block text-sm font-semibold">Atalho<input aria-describedby="shortcut-hint" className="mt-1 min-h-11 w-full rounded-md border border-[var(--border)] px-3" disabled={busy} onChange={(event) => setShortcut(event.target.value)} value={shortcut} /></label>
            <p className="text-xs text-[var(--muted)]" id="shortcut-hint">Use letras, números, hífen ou sublinhado. Exemplo: /horario</p>
            <label className="block text-sm font-semibold">Mensagem<textarea className="mt-1 min-h-32 w-full rounded-md border border-[var(--border)] p-3 font-normal" disabled={busy} onChange={(event) => setMessage(event.target.value)} value={message} /></label>
            {error ? <p className="text-sm text-[var(--danger)]" role="alert">{error}</p> : null}
            <div className="flex justify-end"><Button disabled={busy || !shortcut.trim() || !message.trim()} type="submit">{busy ? "Salvando…" : editing === "new" ? "Criar resposta" : "Salvar alterações"}</Button></div>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}
