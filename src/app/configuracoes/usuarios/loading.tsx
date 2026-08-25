import { SettingsLoadingState } from "@/components/layout/settings-route-state";

export default function UsersLoading() {
  return <SettingsLoadingState description="Acesso dos funcionários à central de atendimento." label="Carregando usuários" title="Usuários" />;
}
