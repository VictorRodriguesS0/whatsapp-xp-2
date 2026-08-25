import { Button } from "@/components/ui/button";
import { PublicStateShell } from "@/components/layout/public-state-shell";

export default function NotFound() {
  return (
    <PublicStateShell
      actions={<Button asChild><a href="/conversas">Voltar para conversas</a></Button>}
      description="O endereço informado não está disponível."
      eyebrow="Erro 404"
      title="Página não encontrada"
    />
  );
}
