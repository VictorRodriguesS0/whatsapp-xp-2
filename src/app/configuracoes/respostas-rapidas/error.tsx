"use client";

import { Button } from "@/components/ui/button";

export default function ErrorState({ reset }: { reset: () => void }) {
  return <main className="grid min-h-dvh place-items-center bg-[var(--canvas)] p-6"><div className="max-w-md text-center"><h1 className="text-2xl font-bold">Não foi possível carregar as respostas rápidas</h1><p className="mt-2 text-sm text-[var(--muted)]">Tente novamente sem interromper o atendimento.</p><div className="mt-5 flex justify-center gap-2"><Button onClick={reset}>Tentar novamente</Button><Button asChild variant="secondary"><a href="/conversas">Voltar</a></Button></div></div></main>;
}
