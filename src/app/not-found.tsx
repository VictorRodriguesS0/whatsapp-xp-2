import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[var(--canvas)] px-5 py-10">
      <section aria-labelledby="not-found-heading" className="w-full max-w-lg border-t-4 border-[var(--accent)] bg-[var(--panel)] px-7 py-8">
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--accent)]">Erro 404</p>
        <h1 className="mt-2 text-2xl font-bold" id="not-found-heading">Página não encontrada</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">O endereço informado não está disponível.</p>
        <Button asChild className="mt-6"><a href="/conversas">Voltar para conversas</a></Button>
      </section>
    </main>
  );
}
