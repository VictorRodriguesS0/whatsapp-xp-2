import type { Metadata } from "next";

import { LegalDocument } from "@/components/legal/legal-document";

export const metadata: Metadata = {
  title: "Política de Privacidade | XP Eletrônicos",
  description: "Como a XP Eletrônicos trata dados no atendimento pelo WhatsApp.",
};

export default function PrivacyPage() {
  return (
    <LegalDocument
      current="privacy"
      description="Como tratamos as informações usadas no atendimento da XP Eletrônicos pelo WhatsApp."
      eyebrow="Privacidade"
      title="Política de Privacidade"
    >
      <section>
        <h2>Dados tratados</h2>
        <p>Podemos tratar nome e identificador do WhatsApp, número de telefone, conteúdo das mensagens, anexos enviados, datas, estados de entrega e registros operacionais do atendimento.</p>
      </section>
      <section>
        <h2>Como usamos os dados</h2>
        <p>Usamos essas informações para responder solicitações, organizar o atendimento, atribuir responsáveis, enviar e receber mensagens e manter a segurança e a continuidade do serviço.</p>
        <p className="mt-3">Quando a loja usa o WhatsApp Business em conjunto com esta plataforma, nomes e telefones da agenda comercial podem ser sincronizados para identificar clientes no atendimento. Remover um contato da agenda desativa o nome sincronizado; o telefone e o histórico operacional podem ser preservados para correlacionar conversas, impedir restaurações incorretas e manter a continuidade do atendimento.</p>
      </section>
      <section>
        <h2>Compartilhamento</h2>
        <p>Os dados podem ser compartilhados, na medida necessária, com a Meta e o WhatsApp, com fornecedores de infraestrutura que sustentam o serviço e com autoridades quando houver obrigação legal.</p>
      </section>
      <section>
        <h2>Retenção e segurança</h2>
        <p>Mantemos os dados somente pelo período necessário às finalidades do atendimento e às obrigações legais aplicáveis. Aplicamos controle de acesso, autenticação e medidas técnicas para reduzir acesso, alteração ou divulgação indevida.</p>
      </section>
      <section>
        <h2>Seus direitos</h2>
        <p>Você pode solicitar confirmação do tratamento, acesso, correção ou exclusão de dados elegíveis. Registros cuja conservação seja exigida por lei poderão ser preservados pelo prazo aplicável.</p>
        <p className="mt-3">Envie sua solicitação para <a className="inline-flex min-h-11 items-center font-semibold text-[var(--accent)] underline underline-offset-4" href="https://wa.me/556195149019">+55 61 9514-9019</a>.</p>
      </section>
    </LegalDocument>
  );
}
