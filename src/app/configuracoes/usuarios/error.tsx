"use client";

import { Button } from "@/components/ui/button";

export default function UsersError({ reset }: { error: Error & { digest?: string }; reset(): void }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[var(--canvas)] px-5 py-10">
      <section aria-labelledby="users-error-heading" className="w-full max-w-lg border-t-4 border-[var(--danger)] bg-[var(--panel)] px-7 py-8">
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--danger)]">Configurações</p>
        <h1 className="mt-2 text-2xl font-bold" id="users-error-heading">Não foi possível carregar os usuários</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">Tente novamente. Se o problema continuar, volte para as conversas.</p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Button onClick={reset}>Tentar novamente</Button>
          <Button asChild variant="secondary"><a href="/conversas">Voltar para conversas</a></Button>
        </div>
      </section>
    </main>
  );
}
