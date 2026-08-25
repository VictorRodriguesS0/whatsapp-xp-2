import { SettingsPageShell } from "@/components/layout/settings-page-shell";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export function SettingsLoadingState({ description, label, title }: { description: string; label: string; title: string }) {
  return (
    <SettingsPageShell description={description} eyebrow="Configurações" title={title}>
      <section aria-busy="true" className="border-y border-[var(--border)] bg-[var(--panel)] px-4 py-12">
        <Spinner label={label} />
      </section>
    </SettingsPageShell>
  );
}

export function SettingsErrorState({
  backLabel = "Voltar para conversas",
  description,
  reset,
  title,
}: {
  backLabel?: string;
  description: string;
  reset(): void;
  title: string;
}) {
  return (
    <SettingsPageShell
      actions={(
        <>
          <Button onClick={reset}>Tentar novamente</Button>
          <Button asChild variant="secondary"><a href="/conversas">{backLabel}</a></Button>
        </>
      )}
      description={description}
      eyebrow="Configurações"
      title={title}
    >
      <p className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-5 text-sm text-[var(--muted)]" role="alert">
        A tela não foi carregada. Nenhuma alteração foi feita.
      </p>
    </SettingsPageShell>
  );
}
