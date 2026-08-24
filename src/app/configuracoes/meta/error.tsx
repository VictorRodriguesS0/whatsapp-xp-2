"use client";

import { Button } from "@/components/ui/button";

export default function MetaHealthError({ reset }: { error: Error & { digest?: string }; reset(): void }) {
  return (
    <main className="min-h-dvh bg-[var(--canvas)] px-4 py-8">
      <div className="mx-auto max-w-5xl border-y border-[var(--border)] py-8">
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--danger)]">Configurações</p>
        <h1 className="mt-1 text-2xl font-bold">Não foi possível carregar a saúde da Meta</h1>
        <p className="mt-3 text-sm text-[var(--muted)]">Tente novamente. Se o problema continuar, volte às conversas e confira mais tarde.</p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Button onClick={reset}>Tentar novamente</Button>
          <Button asChild variant="secondary"><a href="/conversas">Voltar às conversas</a></Button>
        </div>
      </div>
    </main>
  );
}
