import { Spinner } from "@/components/ui/spinner";

export default function MetaHealthLoading() {
  return (
    <main className="min-h-dvh bg-[var(--canvas)] px-4 py-8">
      <div className="mx-auto max-w-5xl border-y border-[var(--border)] py-8">
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--accent)]">Configurações</p>
        <h1 className="mt-1 text-2xl font-bold">Saúde da Meta</h1>
        <div className="mt-8"><Spinner label="Carregando saúde da Meta" /></div>
      </div>
    </main>
  );
}
