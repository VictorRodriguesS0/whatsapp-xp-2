import { KeyRound, Pencil, Power, PowerOff } from "lucide-react";
import type { MouseEvent } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PublicUser } from "@/modules/users/types";

export type ManagedUser = Pick<PublicUser, "id" | "name" | "email" | "role" | "active">;

type UserAction = (user: ManagedUser, event: MouseEvent<HTMLButtonElement>) => void;

type ResponsiveSettingsListProps = {
  busy: boolean;
  currentUserId: string;
  onChangeAccess: UserAction;
  onEdit: UserAction;
  onResetPassword: UserAction;
  users: ManagedUser[];
};

function roleLabel(role: ManagedUser["role"]) {
  return role === "ADMIN" ? "Administrador" : "Atendente";
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <Badge className={active ? "bg-[var(--selected)] text-[var(--accent)]" : "bg-[var(--canvas)] text-[var(--muted)]"}>
      {active ? "Ativo" : "Inativo"}
    </Badge>
  );
}

function DesktopActions({ busy, current, onChangeAccess, onEdit, onResetPassword, user }: {
  busy: boolean;
  current: boolean;
  onChangeAccess: UserAction;
  onEdit: UserAction;
  onResetPassword: UserAction;
  user: ManagedUser;
}) {
  return (
    <div className="flex justify-end gap-1">
      <Button aria-label={`Editar ${user.name}`} data-user-focus-key={`edit:${user.id}`} disabled={busy} onClick={(event) => onEdit(user, event)} size="icon" variant="ghost">
        <Pencil aria-hidden="true" className="size-4" />
      </Button>
      <Button aria-label={`Redefinir senha de ${user.name}`} data-user-focus-key={`reset:${user.id}`} disabled={busy} onClick={(event) => onResetPassword(user, event)} size="icon" variant="ghost">
        <KeyRound aria-hidden="true" className="size-4" />
      </Button>
      {current ? (
        <span className="inline-flex min-h-11 items-center px-3 text-xs font-semibold text-[var(--muted)]">Sua conta atual</span>
      ) : (
        <Button
          aria-label={`${user.active ? "Desativar" : "Ativar"} ${user.name}`}
          data-user-focus-key={`access:${user.id}`}
          disabled={busy}
          onClick={(event) => onChangeAccess(user, event)}
          size="icon"
          variant={user.active ? "ghost" : "secondary"}
        >
          {user.active ? <PowerOff aria-hidden="true" className="size-4" /> : <Power aria-hidden="true" className="size-4" />}
        </Button>
      )}
    </div>
  );
}

function MobileActions({ busy, current, onChangeAccess, onEdit, onResetPassword, user }: {
  busy: boolean;
  current: boolean;
  onChangeAccess: UserAction;
  onEdit: UserAction;
  onResetPassword: UserAction;
  user: ManagedUser;
}) {
  return (
    <div aria-label={`Ações para ${user.name}`} className="mt-4 grid grid-cols-1 gap-2 border-t border-[var(--border)] pt-3 min-[390px]:grid-cols-2">
      <Button data-user-focus-key={`edit:${user.id}`} disabled={busy} onClick={(event) => onEdit(user, event)} variant="secondary">
        <Pencil aria-hidden="true" className="size-4" /> Editar <span className="sr-only">{user.name}</span>
      </Button>
      <Button data-user-focus-key={`reset:${user.id}`} disabled={busy} onClick={(event) => onResetPassword(user, event)} variant="secondary">
        <KeyRound aria-hidden="true" className="size-4" /> Redefinir senha <span className="sr-only">de {user.name}</span>
      </Button>
      {current ? (
        <span className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--muted)] min-[390px]:col-span-2">Sua conta atual</span>
      ) : (
        <Button className="min-[390px]:col-span-2" data-user-focus-key={`access:${user.id}`} disabled={busy} onClick={(event) => onChangeAccess(user, event)} variant={user.active ? "ghost" : "secondary"}>
          {user.active ? <PowerOff aria-hidden="true" className="size-4" /> : <Power aria-hidden="true" className="size-4" />}
          {user.active ? "Desativar" : "Ativar"} <span className="sr-only">{user.name}</span>
        </Button>
      )}
    </div>
  );
}

export function ResponsiveSettingsList({
  busy,
  currentUserId,
  onChangeAccess,
  onEdit,
  onResetPassword,
  users,
}: ResponsiveSettingsListProps) {
  const actionProps = { busy, onChangeAccess, onEdit, onResetPassword };

  return (
    <>
      <div className="mt-3 hidden border-y border-[var(--border)] bg-[var(--panel)] md:block" data-testid="users-desktop-list" data-user-layout="desktop">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="text-xs uppercase tracking-[0.08em] text-[var(--muted)]">
            <tr className="border-b border-[var(--border)]">
              <th className="px-4 py-3 font-semibold" scope="col">Nome</th>
              <th className="px-4 py-3 font-semibold" scope="col">E-mail</th>
              <th className="px-4 py-3 font-semibold" scope="col">Perfil</th>
              <th className="px-4 py-3 font-semibold" scope="col">Status</th>
              <th className="px-4 py-3 text-right font-semibold" scope="col">Ações</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr className="border-b border-[var(--border)] last:border-b-0" key={user.id}>
                <th className="px-4 py-3 font-semibold" scope="row">{user.name}</th>
                <td className="px-4 py-3 text-[var(--muted)]">{user.email}</td>
                <td className="px-4 py-3">{roleLabel(user.role)}</td>
                <td className="px-4 py-3"><StatusBadge active={user.active} /></td>
                <td className="px-4 py-2">
                  <DesktopActions {...actionProps} current={user.id === currentUserId} user={user} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul aria-label="Funcionários" className="mt-3 grid gap-3 md:hidden" data-user-layout="mobile">
        {users.map((user) => (
          <li className="min-w-0 border-y border-[var(--border)] bg-[var(--panel)] px-4 py-4" key={user.id}>
            <div className="min-w-0">
              <p className="font-bold text-[var(--text)]">{user.name}</p>
              <p className="mt-1 break-all text-sm text-[var(--muted)]">{user.email}</p>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <span>{roleLabel(user.role)}</span>
              <StatusBadge active={user.active} />
            </div>
            <MobileActions {...actionProps} current={user.id === currentUserId} user={user} />
          </li>
        ))}
      </ul>
    </>
  );
}
