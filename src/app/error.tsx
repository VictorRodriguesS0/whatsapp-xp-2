"use client";

import { Button } from "@/components/ui/button";
import { PublicStateShell } from "@/components/layout/public-state-shell";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset(): void }) {
  return (
    <PublicStateShell
      actions={(
        <>
          <Button onClick={reset}>Tentar novamente</Button>
          <Button asChild variant="secondary"><a href="/conversas">Voltar para conversas</a></Button>
        </>
      )}
      description="Não foi possível concluir esta operação. Seus dados internos não foram exibidos."
      eyebrow="XP Atendimento"
      title="Algo deu errado"
    />
  );
}
