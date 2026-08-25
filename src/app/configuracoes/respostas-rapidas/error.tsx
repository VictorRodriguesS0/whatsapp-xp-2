"use client";

import { SettingsErrorState } from "@/components/layout/settings-route-state";

export default function ErrorState({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SettingsErrorState backLabel="Voltar" description="Tente novamente sem interromper o atendimento." reset={reset} title="Não foi possível carregar as respostas rápidas" />;
}
