"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

export function ResetPasswordForm({ busy = false, onSubmit }: { busy?: boolean; onSubmit(password: string): void }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [errors, setErrors] = useState<{ password?: string; confirmation?: string }>({});

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const nextErrors: typeof errors = {};
    if (password.length < 10) nextErrors.password = "A senha deve ter pelo menos 10 caracteres.";
    if (confirmation !== password) nextErrors.confirmation = "As senhas não coincidem.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length === 0) onSubmit(password);
  }

  return (
    <form className="mt-6 space-y-5" noValidate onSubmit={submit}>
      <div>
        <label className="mb-1.5 block text-sm font-semibold" htmlFor="new-password">Nova senha</label>
        <Input
          aria-describedby={errors.password ? "new-password-error" : "new-password-help"}
          aria-invalid={Boolean(errors.password)}
          autoComplete="new-password"
          autoFocus
          disabled={busy}
          id="new-password"
          maxLength={1024}
          onChange={(event) => setPassword(event.target.value)}
          type="password"
          value={password}
        />
        <p className="mt-1.5 text-xs text-[var(--muted)]" id="new-password-help">Use pelo menos 10 caracteres.</p>
        {errors.password ? <p className="mt-1.5 text-sm text-[var(--danger)]" id="new-password-error" role="alert">{errors.password}</p> : null}
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-semibold" htmlFor="confirm-password">Confirmar nova senha</label>
        <Input
          aria-describedby={errors.confirmation ? "confirm-password-error" : undefined}
          aria-invalid={Boolean(errors.confirmation)}
          autoComplete="new-password"
          disabled={busy}
          id="confirm-password"
          maxLength={1024}
          onChange={(event) => setConfirmation(event.target.value)}
          type="password"
          value={confirmation}
        />
        {errors.confirmation ? <p className="mt-1.5 text-sm text-[var(--danger)]" id="confirm-password-error" role="alert">{errors.confirmation}</p> : null}
      </div>
      <div className="flex justify-end border-t border-[var(--border)] pt-4">
        <Button disabled={busy} type="submit">{busy ? <Spinner className="text-white" label="Redefinindo" /> : "Redefinir senha"}</Button>
      </div>
    </form>
  );
}
