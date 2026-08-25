"use client";

import { SettingsErrorState } from "@/components/layout/settings-route-state";

export default function WhatsAppSettingsError({ reset }: { error: Error & { digest?: string }; reset(): void }) {
  return (
    <SettingsErrorState
      description="Tente novamente. Nenhum detalhe interno da integração foi exibido."
      reset={reset}
      title="Não foi possível carregar a configuração do WhatsApp"
    />
  );
}
