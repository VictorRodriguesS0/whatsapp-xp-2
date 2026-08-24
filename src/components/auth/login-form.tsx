"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { publicErrorMessage } from "@/lib/public-error";

export function LoginForm() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      });
      if (response.ok) {
        window.location.assign("/conversas");
        return;
      }
      setError(publicErrorMessage("login", response.status));
    } catch {
      setError(publicErrorMessage("login", undefined, true));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="mt-8 space-y-5" noValidate onSubmit={submit}>
      <div>
        <label className="mb-1.5 block text-sm font-semibold text-[var(--text)]" htmlFor="email">E-mail</label>
        <Input autoComplete="email" disabled={loading} id="email" inputMode="email" name="email" required type="email" />
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-semibold text-[var(--text)]" htmlFor="password">Senha</label>
        <Input autoComplete="current-password" disabled={loading} id="password" name="password" required type="password" />
      </div>
      {error ? <p className="rounded-xl bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] px-3 py-2 text-sm text-[var(--danger)]" ref={errorRef} role="alert" tabIndex={-1}>{error}</p> : null}
      <Button className="w-full" disabled={loading} type="submit">{loading ? <Spinner className="text-white" label="Entrando" /> : "Entrar"}</Button>
    </form>
  );
}
