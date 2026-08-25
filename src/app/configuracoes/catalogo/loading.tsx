import { SettingsLoadingState } from "@/components/layout/settings-route-state";

export default function CatalogSettingsLoading() {
  return (
    <SettingsLoadingState
      description="Situação do catálogo oficial conectado ao número da XP Eletrônicos."
      label="Carregando catálogo do WhatsApp"
      title="Catálogo do WhatsApp"
    />
  );
}
