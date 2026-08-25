"use client";

import { SettingsErrorState } from "@/components/layout/settings-route-state";

export default function UsersError({ reset }: { error: Error & { digest?: string }; reset(): void }) {
  return <SettingsErrorState description="Tente novamente. Se o problema continuar, volte para as conversas." reset={reset} title="Não foi possível carregar os usuários" />;
}
