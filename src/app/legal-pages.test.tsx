import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import DataDeletionPage, { metadata as deletionMetadata } from "./exclusao-de-dados/page";
import PrivacyPage, { metadata as privacyMetadata } from "./privacidade/page";

describe("public legal pages", () => {
  it("publishes a complete privacy policy without authentication or forms", () => {
    render(<PrivacyPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Política de Privacidade" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Dados tratados" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Como usamos os dados" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Compartilhamento" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Retenção e segurança" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Seus direitos" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "+55 61 9514-9019" })).toHaveAttribute(
      "href",
      "https://wa.me/556195149019",
    );
    expect(screen.getByRole("link", { name: "Solicitar exclusão de dados" })).toHaveAttribute(
      "href",
      "/exclusao-de-dados",
    );
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(privacyMetadata.title).toBe("Política de Privacidade | XP Eletrônicos");
  });

  it("publishes executable data-deletion instructions on the official channel", () => {
    render(<DataDeletionPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Exclusão de dados" })).toBeInTheDocument();
    expect(screen.getByText("Solicitação de exclusão de dados")).toBeInTheDocument();
    expect(screen.getByText(/confirmar sua identidade/i)).toBeInTheDocument();
    expect(screen.getByText(/excluídos ou anonimizados/i)).toBeInTheDocument();
    expect(screen.getByText(/obrigação legal/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Enviar solicitação pelo WhatsApp" })).toHaveAttribute(
      "href",
      "https://wa.me/556195149019?text=Solicita%C3%A7%C3%A3o%20de%20exclus%C3%A3o%20de%20dados",
    );
    expect(screen.getByRole("link", { name: "Ler a Política de Privacidade" })).toHaveAttribute(
      "href",
      "/privacidade",
    );
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(deletionMetadata.title).toBe("Exclusão de dados | XP Eletrônicos");
  });
});
