"use client";

import { SettingsErrorState } from "@/components/layout/settings-route-state";

export default function CatalogSettingsError({
  reset,
}: {
  error: Error & { digest?: string };
  reset(): void;
}) {
  return (
    <SettingsErrorState
      backLabel="Voltar às conversas"
      description="Tente novamente. Nenhuma configuração do catálogo foi alterada."
      reset={reset}
      title="Não foi possível carregar o catálogo"
    />
  );
}
