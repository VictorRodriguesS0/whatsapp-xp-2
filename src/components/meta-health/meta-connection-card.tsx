"use client";

import { Link2, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMetaConnection } from "@/hooks/use-meta-connection";
import type { MetaHealthSummaryDto } from "@/modules/meta-health/types";
import type { ConnectionAttemptState, MetaConnectionPublicConfig } from "@/modules/meta-connection/types";

const statusCopy: Record<ConnectionAttemptState, string> = {
  WAITING: "Pronto para conectar pela Meta", EXCHANGING: "Validando autorização…", VERIFYING: "Confirmando conexão na Meta…",
  CONNECTED: "Conexão confirmada pela Meta", CANCELLED: "Tentativa encerrada", FAILED: "Reconexão não concluída", EXPIRED: "Esta tentativa expirou",
};
const errorCopy: Record<string, string> = {
  ASSET_MISMATCH: "A conta ou o número escolhido não corresponde à integração desta loja. Confira a seleção na Meta.",
  TOKEN_INVALID: "A autorização foi recusada ou expirou. O responsável pela integração deve conferir o acesso ao aplicativo e a credencial do servidor.",
  META_UNAVAILABLE: "A Meta não respondeu à validação. Consulte o estado da conexão antes de iniciar outro vínculo.",
  META_INVALID_RESPONSE: "Não foi possível validar a resposta da Meta. Confira o acesso ao aplicativo e atualize a conexão.",
  WEBHOOK_CONFIGURATION_REQUIRED: "O recebimento de eventos ainda precisa ser configurado na Meta pelo responsável pela integração.",
  WAITING_FOR_META: "A Meta ainda não confirmou o número conectado. Isso pode levar alguns minutos.",
};
const date = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

export function MetaConnectionCard({ connection, config, phoneNumber, onRefresh }: {
  connection: MetaHealthSummaryDto["connection"]; config: MetaConnectionPublicConfig;
  phoneNumber: string | null; onRefresh(): void | Promise<unknown>;
}) {
  const flow = useMetaConnection(config, onRefresh);
  const active = !!flow.attempt && ["WAITING", "EXCHANGING", "VERIFYING"].includes(flow.attempt.state);
  const connected = connection.state === "CONNECTED";
  const offline = connection.state === "DISCONNECTED";
  const Icon = offline ? Unplug : Link2;
  return (
    <section aria-labelledby="whatsapp-connection-heading" className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Icon aria-hidden="true" className={`mt-1 size-5 ${offline ? "text-[var(--danger)]" : "text-[var(--accent)]"}`} />
          <div>
            <h2 id="whatsapp-connection-heading" className="text-base font-bold">Conexão do WhatsApp</h2>
            <p className={`mt-1 text-lg font-semibold ${offline ? "text-[var(--danger)]" : "text-[var(--text)]"}`}>
              {offline ? "Desconectado" : connected ? "Conectado" : "A confirmar"}
            </p>
            {phoneNumber ? <p className="mt-1 text-sm text-[var(--muted)]">{phoneNumber}</p> : null}
          </div>
        </div>
        <Button size="small" variant="secondary" onClick={() => void onRefresh()}>Atualizar conexão</Button>
      </div>
      <div className="mt-4 space-y-2 text-sm text-[var(--muted)]">
        {offline ? <p>Novos envios pela central estão suspensos até a conexão ser confirmada.</p> : null}
        {connection.stale ? <p>Esta informação precisa de uma confirmação recente da Meta.</p> : null}
        {connection.observedAt ? <p>Última evidência: {date.format(new Date(connection.observedAt))}.</p> : null}
      </div>
      {(!connected || connection.stale) && !active ? (
        <div className="mt-5 space-y-3">
          <Button disabled={!config.enabled || flow.preparing || flow.recovering} onClick={() => void flow.prepare()}>
            {flow.preparing ? "Preparando…" : "Reconectar WhatsApp"}
          </Button>
          {!config.enabled && config.reason ? <p className="text-sm text-[var(--muted)]">{config.reason}</p> : null}
        </div>
      ) : null}
      {flow.attempt ? (
        <div className="mt-5 border-t border-[var(--border)] pt-5">
          <p role="status" className="text-sm font-semibold">{statusCopy[flow.attempt.state]}</p>
          {active ? <>
            <p className="mt-3 text-sm">O novo vínculo desconecta os aparelhos adicionais. Tenha-os por perto para vinculá-los novamente pelo celular principal.</p>
            <p className="mt-2 text-sm text-[var(--muted)]">Na janela oficial da Meta, escolha o número desta loja e siga a etapa de QR code ou código de acesso no WhatsApp Business principal. O histórico já salvo nesta central será preservado.</p>
            <div className="mt-4 flex flex-wrap gap-3">
              {flow.ready && !flow.launched ? <Button onClick={flow.launch}>Continuar na Meta</Button> : null}
              {flow.launched || !flow.ready ? <Button variant="secondary" onClick={() => void flow.check()}>Consultar tentativa</Button> : null}
              <Button variant="ghost" onClick={() => void flow.cancel()}>Encerrar tentativa</Button>
            </div>
            {flow.launched ? <p className="mt-3 text-xs text-[var(--muted)]">Se a janela não abriu, permita pop-ups neste site. Fechar a janela não confirma a reconexão.</p> : null}
            {flow.pollingPaused ? <p className="mt-3 text-sm">A confirmação automática foi pausada. Use “Consultar tentativa” para verificar novamente.</p> : null}
          </> : null}
          {flow.attempt.state === "CONNECTED" ? <p className="mt-2 text-sm">Vincule novamente os aparelhos adicionais pelo celular principal.</p> : null}
          {flow.attempt.errorCode && errorCopy[flow.attempt.errorCode] ? <p className="mt-3 text-sm text-[var(--attention-text)]">{errorCopy[flow.attempt.errorCode]}</p> : null}
        </div>
      ) : null}
      {flow.notice ? <p role="alert" className="mt-4 text-sm text-[var(--attention-text)]">{flow.notice}</p> : null}
    </section>
  );
}
