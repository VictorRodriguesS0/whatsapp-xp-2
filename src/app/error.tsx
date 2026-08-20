"use client";

import { Button } from "@/components/ui/button";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset(): void }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[var(--canvas)] px-5 py-10">
      <section aria-labelledby="global-error-heading" className="w-full max-w-lg border-t-4 border-[var(--danger)] bg-[var(--panel)] px-7 py-8">
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--danger)]">XP Atendimento</p>
        <h1 className="mt-2 text-2xl font-bold" id="global-error-heading">Algo deu errado</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">Não foi possível concluir esta operação.</p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Button onClick={reset}>Tentar novamente</Button>
          <Button asChild variant="secondary"><a href="/conversas">Voltar para conversas</a></Button>
        </div>
      </section>
    </main>
  );
}
