"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import type { UserRole } from "@/generated/prisma/enums";

export type EditableUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
};

export type UserFormValues = {
  name: string;
  email: string;
  role: UserRole;
  password?: string;
};

export type UserFormPatch = Partial<Pick<UserFormValues, "name" | "email" | "role">>;

type UserFormProps = {
  mode: "create";
  initialUser?: never;
  busy?: boolean;
  onSubmit(values: UserFormValues): void;
} | {
  mode: "edit";
  initialUser: EditableUser;
  busy?: boolean;
  onSubmit(values: UserFormPatch): void;
};

type Errors = Partial<Record<"name" | "email" | "password", string>>;

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function FieldError({ children, id }: { children?: string; id: string }) {
  return children ? <p className="mt-1.5 text-sm text-[var(--danger)]" id={id} role="alert">{children}</p> : null;
}

export function UserForm(props: UserFormProps) {
  const { mode, initialUser, busy = false } = props;
  const [name, setName] = useState(initialUser?.name ?? "");
  const [email, setEmail] = useState(initialUser?.email ?? "");
  const [role, setRole] = useState<UserRole>(initialUser?.role ?? "ATTENDANT");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [unchanged, setUnchanged] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    const normalizedName = name.trim();
    const normalizedEmail = email.trim().toLowerCase();
    const nextErrors: Errors = {};
    if (!normalizedName) nextErrors.name = "Informe o nome.";
    if (!emailPattern.test(normalizedEmail)) nextErrors.email = "Informe um e-mail válido.";
    if (mode === "create" && password.length < 10) nextErrors.password = "A senha deve ter pelo menos 10 caracteres.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    if (props.mode === "edit") {
      const patch: UserFormPatch = {};
      if (normalizedName !== props.initialUser.name.trim()) patch.name = normalizedName;
      if (normalizedEmail !== props.initialUser.email.trim().toLowerCase()) patch.email = normalizedEmail;
      if (role !== props.initialUser.role) patch.role = role;
      if (Object.keys(patch).length === 0) {
        setUnchanged(true);
        return;
      }
      props.onSubmit(patch);
      return;
    }

    props.onSubmit({ name: normalizedName, email: normalizedEmail, role, password });
  }

  return (
    <form className="mt-6 space-y-5" noValidate onSubmit={submit}>
      <div>
        <label className="mb-1.5 block text-sm font-semibold" htmlFor={`${mode}-user-name`}>Nome</label>
        <Input
          aria-describedby={errors.name ? `${mode}-user-name-error` : undefined}
          aria-invalid={Boolean(errors.name)}
          autoComplete="name"
          autoFocus
          disabled={busy}
          id={`${mode}-user-name`}
          maxLength={120}
          onChange={(event) => { setName(event.target.value); setUnchanged(false); }}
          value={name}
        />
        <FieldError id={`${mode}-user-name-error`}>{errors.name}</FieldError>
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-semibold" htmlFor={`${mode}-user-email`}>E-mail</label>
        <Input
          aria-describedby={errors.email ? `${mode}-user-email-error` : undefined}
          aria-invalid={Boolean(errors.email)}
          autoComplete="email"
          disabled={busy}
          id={`${mode}-user-email`}
          inputMode="email"
          maxLength={320}
          onChange={(event) => { setEmail(event.target.value); setUnchanged(false); }}
          type="email"
          value={email}
        />
        <FieldError id={`${mode}-user-email-error`}>{errors.email}</FieldError>
      </div>
      <div>
        <span className="mb-1.5 block text-sm font-semibold" id={`${mode}-user-role-label`}>Perfil</span>
        <Select disabled={busy} onValueChange={(value) => { setRole(value as UserRole); setUnchanged(false); }} value={role}>
          <SelectTrigger aria-labelledby={`${mode}-user-role-label`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ATTENDANT">Atendente</SelectItem>
            <SelectItem value="ADMIN">Administrador</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {mode === "create" ? (
        <div>
          <label className="mb-1.5 block text-sm font-semibold" htmlFor="create-user-password">Senha inicial</label>
          <Input
            aria-describedby={errors.password ? "create-user-password-error" : "create-user-password-help"}
            aria-invalid={Boolean(errors.password)}
            autoComplete="new-password"
            disabled={busy}
            id="create-user-password"
            maxLength={1024}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            value={password}
          />
          <p className="mt-1.5 text-xs text-[var(--muted)]" id="create-user-password-help">Use pelo menos 10 caracteres.</p>
          <FieldError id="create-user-password-error">{errors.password}</FieldError>
        </div>
      ) : null}
      {unchanged ? <p className="text-sm text-[var(--muted)]" role="status">Nenhuma alteração para salvar.</p> : null}
      <div className="flex justify-end border-t border-[var(--border)] pt-4">
        <Button disabled={busy} type="submit">
          {busy ? <Spinner className="text-white" label="Salvando" /> : mode === "create" ? "Criar usuário" : "Salvar alterações"}
        </Button>
      </div>
    </form>
  );
}
