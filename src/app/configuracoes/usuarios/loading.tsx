import { Spinner } from "@/components/ui/spinner";

export default function UsersLoading() {
  return (
    <main aria-labelledby="users-loading-heading" className="min-h-dvh bg-[var(--canvas)] px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--accent)]">Configurações</p>
        <h1 className="mt-1 text-2xl font-bold" id="users-loading-heading">Usuários</h1>
        <div className="mt-6 border-y border-[var(--border)] bg-[var(--panel)] px-4 py-12">
          <Spinner label="Carregando usuários" />
        </div>
      </div>
    </main>
  );
}
