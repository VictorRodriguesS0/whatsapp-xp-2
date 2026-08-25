import { SettingsLoadingState } from "@/components/layout/settings-route-state";

export default function MetaHealthLoading() {
  return <SettingsLoadingState description="Qualidade do número, situação da conta e alertas da integração." label="Carregando saúde da Meta" title="Saúde da Meta" />;
}
