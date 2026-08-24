"use client";

import { LogOut, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type RefObject } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { SettingsPageShell } from "@/components/layout/settings-page-shell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { SessionUser } from "@/modules/auth/session";

import { ResetPasswordForm } from "./reset-password-form";
import { ResponsiveSettingsList, type ManagedUser } from "./responsive-settings-list";
import { UserForm, type UserFormPatch, type UserFormValues } from "./user-form";

type MutationKind = "create" | "edit" | "password" | "activate" | "deactivate";
type BusyKind = MutationKind | "logout";
export type { ManagedUser } from "./responsive-settings-list";

function mutationError(kind: MutationKind, status?: number, failure?: "network" | "unexpected") {
  if (failure === "network") return "Sem conexão. Confira sua rede e tente novamente.";
  if (failure === "unexpected") return "Resposta inesperada do servidor. Tente novamente.";
  if (status === 429) return "Muitas solicitações. Aguarde um momento e tente novamente.";
  if (status === 409 && kind === "deactivate") {
    return "Não foi possível alterar esse acesso. Mantenha pelo menos um administrador ativo.";
  }
  if (status === 409 && kind === "edit") {
    return "Não foi possível salvar. Verifique se o e-mail já está em uso e mantenha outro administrador ativo.";
  }
  if (status === 409 && kind === "create") return "Este e-mail já está em uso.";
  if (status === 404) return "Esse usuário não está mais disponível.";
  if (kind === "password") return "Não foi possível redefinir a senha.";
  if (kind === "activate" || kind === "deactivate") return "Não foi possível alterar o acesso do usuário.";
  return kind === "create" ? "Não foi possível criar o usuário." : "Não foi possível salvar as alterações.";
}

function sortUsers(users: ManagedUser[]) {
  return [...users].sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
}

function isManagedUser(value: unknown): value is ManagedUser {
  if (!value || typeof value !== "object") return false;
  const user = value as Record<string, unknown>;
  return typeof user.id === "string"
    && typeof user.name === "string"
    && typeof user.email === "string"
    && (user.role === "ADMIN" || user.role === "ATTENDANT")
    && typeof user.active === "boolean";
}

export function UsersScreen({ currentUser, initialUsers }: { currentUser: SessionUser; initialUsers: ManagedUser[] }) {
  const router = useRouter();
  const [users, setUsers] = useState(() => sortUsers(initialUsers));
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<ManagedUser | null>(null);
  const [resetUser, setResetUser] = useState<ManagedUser | null>(null);
  const [accessUser, setAccessUser] = useState<ManagedUser | null>(null);
  const [busy, setBusy] = useState<BusyKind | null>(null);
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  const busyRef = useRef(false);
  const requestSequence = useRef(0);
  const mounted = useRef(true);
  const editTrigger = useRef<HTMLButtonElement | null>(null);
  const resetTrigger = useRef<HTMLButtonElement | null>(null);
  const accessTrigger = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  function notify(message: string) {
    setToast({ id: Date.now(), message });
  }

  function mergeUser(user: ManagedUser) {
    setUsers((current) => sortUsers(current.some((item) => item.id === user.id)
      ? current.map((item) => item.id === user.id ? user : item)
      : [...current, user]));
  }

  function restoreFocus(trigger: RefObject<HTMLButtonElement | null>, event: { preventDefault(): void }) {
    event.preventDefault();
    const element = trigger.current;
    trigger.current = null;
    const focusKey = element?.dataset.userFocusKey;
    const preferredLayout = typeof window.matchMedia === "function"
      ? (window.matchMedia("(min-width: 768px)").matches ? "desktop" : "mobile")
      : null;
    const equivalent = focusKey && preferredLayout
      ? Array.from(document.querySelectorAll<HTMLButtonElement>("[data-user-focus-key]"))
        .find((candidate) => candidate.dataset.userFocusKey === focusKey
          && candidate.closest("[data-user-layout]")?.getAttribute("data-user-layout") === preferredLayout)
      : null;
    const target = equivalent ?? element;
    if (target?.isConnected) target.focus();
  }

  async function mutate(url: string, method: "POST" | "PATCH", body: object, kind: MutationKind): Promise<ManagedUser | null> {
    if (busyRef.current) return null;
    busyRef.current = true;
    const sequence = ++requestSequence.current;
    setBusy(kind);
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      if (mounted.current && sequence === requestSequence.current) notify(mutationError(kind, undefined, "network"));
      if (mounted.current && sequence === requestSequence.current) setBusy(null);
      busyRef.current = false;
      return null;
    }

    try {
      if (response.status === 401) {
        router.replace("/login?motivo=sessao-expirada");
        return null;
      }
      if (!response.ok) {
        if (mounted.current && sequence === requestSequence.current) notify(mutationError(kind, response.status));
        return null;
      }
      let payload: { user?: unknown };
      try {
        payload = await response.json() as { user?: unknown };
      } catch {
        if (mounted.current && sequence === requestSequence.current) notify(mutationError(kind, undefined, "unexpected"));
        return null;
      }
      if (!isManagedUser(payload.user)) {
        if (mounted.current && sequence === requestSequence.current) notify(mutationError(kind, undefined, "unexpected"));
        return null;
      }
      if (!mounted.current || sequence !== requestSequence.current) return null;
      return payload.user;
    } finally {
      if (mounted.current && sequence === requestSequence.current) setBusy(null);
      busyRef.current = false;
    }
  }

  async function createUser(values: UserFormValues) {
    const user = await mutate("/api/users", "POST", values, "create");
    if (!user) return;
    mergeUser(user);
    setCreateOpen(false);
    notify("Usuário criado.");
  }

  async function updateUser(values: UserFormPatch) {
    if (!editUser) return;
    const user = await mutate(`/api/users/${editUser.id}`, "PATCH", values, "edit");
    if (!user) return;
    mergeUser(user);
    setEditUser(null);
    if (user.id === currentUser.id && user.role === "ATTENDANT") {
      router.replace("/conversas");
      router.refresh();
      return;
    }
    notify("Alterações salvas.");
  }

  async function resetPassword(password: string) {
    if (!resetUser) return;
    const user = await mutate(`/api/users/${resetUser.id}/reset-password`, "POST", { password }, "password");
    if (!user) return;
    mergeUser(user);
    setResetUser(null);
    if (user.id === currentUser.id) {
      router.replace("/login");
      router.refresh();
      return;
    }
    notify("Senha redefinida. As sessões anteriores foram encerradas.");
  }

  async function changeAccess() {
    if (!accessUser || accessUser.id === currentUser.id) return;
    const active = !accessUser.active;
    const kind = active ? "activate" : "deactivate";
    const user = await mutate(`/api/users/${accessUser.id}`, "PATCH", { active }, kind);
    if (!user) return;
    mergeUser(user);
    setAccessUser(null);
    notify(active ? "Usuário ativado." : "Usuário desativado.");
  }

  async function logout() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy("logout");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) {
        notify("Não foi possível sair. Tente novamente.");
        return;
      }
      router.replace("/login");
    } catch {
      notify("Não foi possível sair. Confira sua conexão e tente novamente.");
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(null);
    }
  }

  return (
    <>
      <SettingsPageShell
        actions={(
          <>
            <Dialog onOpenChange={(open) => { if (!busy) setCreateOpen(open); }} open={createOpen}>
              <DialogTrigger asChild>
                <Button disabled={Boolean(busy)}><Plus aria-hidden="true" className="size-4" />Novo usuário</Button>
              </DialogTrigger>
              <DialogContent className="modal-dialog">
                <DialogTitle className="pr-12 text-xl font-bold">Novo usuário</DialogTitle>
                <DialogDescription className="mt-1 text-sm text-[var(--muted)]">Defina o acesso inicial do funcionário.</DialogDescription>
                <UserForm busy={busy === "create"} mode="create" onSubmit={(values) => void createUser(values)} />
              </DialogContent>
            </Dialog>
            <Button disabled={Boolean(busy)} onClick={() => void logout()} variant="secondary"><LogOut aria-hidden="true" className="size-4" />Sair</Button>
          </>
        )}
        description="Acesso dos funcionários à central de atendimento."
        eyebrow="Configurações"
        title="Usuários"
      >
        <section aria-labelledby="directory-heading" className="mt-6">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-base font-bold" id="directory-heading">Funcionários</h2>
            <p className="text-sm text-[var(--muted)]">{users.length} {users.length === 1 ? "usuário" : "usuários"}</p>
          </div>
          <ResponsiveSettingsList
            busy={Boolean(busy)}
            currentUserId={currentUser.id}
            onChangeAccess={(user, event) => { accessTrigger.current = event.currentTarget; setAccessUser(user); }}
            onEdit={(user, event) => { editTrigger.current = event.currentTarget; setEditUser(user); }}
            onResetPassword={(user, event) => { resetTrigger.current = event.currentTarget; setResetUser(user); }}
            users={users}
          />
        </section>
      </SettingsPageShell>

      <Dialog onOpenChange={(open) => { if (!open && !busy) setEditUser(null); }} open={Boolean(editUser)}>
        <DialogContent className="modal-dialog" onCloseAutoFocus={(event) => restoreFocus(editTrigger, event)}>
          <DialogTitle className="pr-12 text-xl font-bold">Editar usuário</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-[var(--muted)]">Altere nome, e-mail ou perfil.</DialogDescription>
          {editUser ? <UserForm busy={busy === "edit"} initialUser={editUser} key={editUser.id} mode="edit" onSubmit={(values) => void updateUser(values)} /> : null}
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={(open) => { if (!open && !busy) setResetUser(null); }} open={Boolean(resetUser)}>
        <DialogContent className="modal-dialog" onCloseAutoFocus={(event) => restoreFocus(resetTrigger, event)}>
          <DialogTitle className="pr-12 text-xl font-bold">Redefinir senha</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-[var(--muted)]">{resetUser ? `Crie uma nova senha para ${resetUser.name}. As sessões atuais serão encerradas.` : ""}</DialogDescription>
          {resetUser ? <ResetPasswordForm busy={busy === "password"} key={resetUser.id} onSubmit={(password) => void resetPassword(password)} /> : null}
        </DialogContent>
      </Dialog>

      <AlertDialog onOpenChange={(open) => { if (!open && !busy) setAccessUser(null); }} open={Boolean(accessUser)}>
        <AlertDialogContent className="modal-dialog" onCloseAutoFocus={(event) => restoreFocus(accessTrigger, event)}>
          <AlertDialogTitle className="text-xl font-bold">{accessUser?.active ? "Desativar usuário?" : "Ativar usuário?"}</AlertDialogTitle>
          <AlertDialogDescription className="mt-2 text-sm leading-6 text-[var(--muted)]">
            {accessUser?.active
              ? `${accessUser.name} perderá o acesso imediatamente. O histórico de atendimento será preservado.`
              : `${accessUser?.name ?? "O usuário"} poderá voltar a acessar a central.`}
          </AlertDialogDescription>
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialogCancel asChild><Button disabled={Boolean(busy)} variant="secondary">Cancelar</Button></AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button data-confirm disabled={Boolean(busy)} onClick={() => void changeAccess()} variant={accessUser?.active ? "danger" : "primary"}>
                {busy ? "Salvando…" : accessUser?.active ? "Desativar usuário" : "Ativar usuário"}
              </Button>
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>

      {toast ? (
        <div aria-atomic="true" aria-live="polite" className="fixed bottom-4 left-4 right-4 z-[60] flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--panel)] py-1 pl-4 pr-1 text-sm font-semibold shadow-[0_12px_32px_rgba(32,37,34,0.12)] sm:left-auto sm:max-w-sm" key={toast.id} role="status">
          <span>{toast.message}</span>
          <Button aria-label="Fechar aviso" onClick={() => setToast(null)} size="icon" variant="ghost"><X aria-hidden="true" className="size-4" /></Button>
        </div>
      ) : null}
    </>
  );
}
