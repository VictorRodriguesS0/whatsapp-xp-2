import type { Metadata } from "next";

import { LegalDocument } from "@/components/legal/legal-document";

export const metadata: Metadata = {
  title: "Exclusão de dados | XP Eletrônicos",
  description: "Como solicitar acesso, correção ou exclusão de dados do atendimento da XP Eletrônicos.",
};

export default function DataDeletionPage() {
  return (
    <LegalDocument
      current="deletion"
      description="Use o canal oficial para solicitar acesso, correção ou exclusão de dados vinculados ao seu atendimento."
      eyebrow="Direitos do titular"
      title="Exclusão de dados"
    >
      <section>
        <h2>Como fazer a solicitação</h2>
        <p>Envie a frase <strong>Solicitação de exclusão de dados</strong> pelo WhatsApp oficial da XP Eletrônicos.</p>
        <a className="mt-5 inline-flex min-h-11 items-center rounded-md bg-[var(--accent)] px-5 font-semibold text-white hover:bg-[var(--accent-hover)]" href="https://wa.me/556195149019?text=Solicita%C3%A7%C3%A3o%20de%20exclus%C3%A3o%20de%20dados">Enviar solicitação pelo WhatsApp</a>
      </section>
      <section>
        <h2>Confirmação de identidade</h2>
        <p>Para proteger seus dados, poderemos confirmar sua identidade e pedir informações suficientes para localizar o atendimento relacionado ao pedido.</p>
      </section>
      <section>
        <h2>O que acontece depois</h2>
        <ul>
          <li>Confirmaremos o recebimento pelo mesmo canal.</li>
          <li>Localizaremos e avaliaremos os dados vinculados ao atendimento.</li>
          <li>Os dados elegíveis serão excluídos ou anonimizados.</li>
          <li>Comunicaremos o resultado da solicitação pelo mesmo canal.</li>
        </ul>
      </section>
      <section>
        <h2>Conservação necessária</h2>
        <p>Dados sujeitos a obrigação legal, regulatória ou necessários ao exercício de direitos poderão ser preservados pelo prazo aplicável. Nesses casos, o uso permanecerá limitado à finalidade que justificou a conservação.</p>
      </section>
    </LegalDocument>
  );
}
