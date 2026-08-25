"use client";

import { SettingsErrorState } from "@/components/layout/settings-route-state";

export default function MetaHealthError({ reset }: { error: Error & { digest?: string }; reset(): void }) {
  return <SettingsErrorState backLabel="Voltar às conversas" description="Tente novamente. Se o problema continuar, volte às conversas e confira mais tarde." reset={reset} title="Não foi possível carregar a saúde da Meta" />;
}
