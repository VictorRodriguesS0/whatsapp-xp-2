import { SettingsLoadingState } from "@/components/layout/settings-route-state";

export default function WhatsAppSettingsLoading() {
  return (
    <SettingsLoadingState
      description="Carregando modelo aprovado e estado da janela de atendimento."
      label="Carregando configuração do WhatsApp"
      title="WhatsApp e janela de atendimento"
    />
  );
}
