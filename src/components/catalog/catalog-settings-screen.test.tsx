import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CatalogStatusDto } from "@/modules/catalog/types";

import { CatalogSettingsScreen } from "./catalog-settings-screen";

vi.mock("@/components/theme/theme-menu", () => ({
  ThemeMenu: () => <button aria-label="Tema" type="button" />,
}));

const ready: CatalogStatusDto = {
  configured: true,
  ready: true,
  catalog: { idSuffix: "…123456", name: "XP Eletrônicos", productCount: 42 },
  commerce: { catalogVisible: true, cartEnabled: true },
  freshness: "FRESH",
  lastSuccessAt: "2026-08-24T12:00:00.000Z",
  errorCode: null,
};

afterEach(() => vi.restoreAllMocks());

describe("CatalogSettingsScreen", () => {
  it("shows a restrained semantic diagnostic with masked identifiers", () => {
    render(<CatalogSettingsScreen initialStatus={ready} />);

    expect(screen.getByRole("heading", { name: "Catálogo do WhatsApp" })).toBeVisible();
    expect(screen.getByText("Pronto para uso")).toBeVisible();
    expect(screen.getAllByText("XP Eletrônicos").length).toBeGreaterThan(0);
    expect(screen.getByText("…123456")).toBeVisible();
    expect(screen.getByText("42 produtos")).toBeVisible();
    expect(screen.getByText("Visível no WhatsApp")).toBeVisible();
    expect(screen.getByText("Carrinho ativo")).toBeVisible();
    expect(screen.getByText("Atualizado")).toBeVisible();
    expect(screen.getByText("24/08/2026, 09:00")).toBeVisible();
    expect(screen.queryByRole("button", { name: /adicionar|editar|excluir produto/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/access.?token|graph\.facebook\.com|123456789012345/i);
  });

  it("explains public remediation for visibility, cart, stale and permission states", () => {
    const { rerender } = render(<CatalogSettingsScreen initialStatus={{
      ...ready,
      ready: false,
      commerce: { catalogVisible: false, cartEnabled: false },
    }} />);
    expect(screen.getByText("Configuração incompleta")).toBeVisible();
    expect(screen.getByText(/Ative a visibilidade do catálogo/i)).toBeVisible();
    expect(screen.getByText(/Ative o carrinho/i)).toBeVisible();

    rerender(<CatalogSettingsScreen key="empty" initialStatus={{
      ...ready,
      ready: false,
      catalog: { ...ready.catalog!, productCount: 0 },
    }} />);
    expect(screen.getByText(/publique ao menos um produto no catálogo oficial/i)).toBeVisible();

    rerender(<CatalogSettingsScreen key="stale" initialStatus={{
      ...ready,
      ready: false,
      freshness: "STALE",
      errorCode: "META_TIMEOUT",
    }} />);
    expect(screen.getByText("Requer atenção")).toBeVisible();
    expect(screen.getByText("Dados anteriores")).toBeVisible();
    expect(screen.getByText(/últimos dados válidos continuam visíveis/i)).toBeVisible();

    rerender(<CatalogSettingsScreen key="permission" initialStatus={{
      ...ready,
      ready: false,
      freshness: "UNAVAILABLE",
      catalog: null,
      commerce: null,
      errorCode: "CATALOG_PERMISSION_REQUIRED",
    }} />);
    expect(screen.getByText(/Conceda ao usuário do sistema acesso ao catálogo/i)).toBeVisible();
  });

  it("shows unconfigured state without inventing catalog details", () => {
    render(<CatalogSettingsScreen initialStatus={{
      configured: false,
      ready: false,
      catalog: null,
      commerce: null,
      freshness: "UNAVAILABLE",
      lastSuccessAt: null,
      errorCode: "CATALOG_NOT_CONFIGURED",
    }} />);
    expect(screen.getByText("Não configurado")).toBeVisible();
    expect(screen.getByText(/Configure o identificador do catálogo da XP no servidor/i)).toBeVisible();
    expect(screen.getAllByText("Não disponível").length).toBeGreaterThan(0);
  });

  it("keeps the current summary visible and explains a rate-limited refresh", async () => {
    let resolveRequest!: (value: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise((resolve) => { resolveRequest = resolve; }));
    render(<CatalogSettingsScreen initialStatus={ready} />);
    const button = screen.getByRole("button", { name: "Atualizar agora" });

    fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(screen.getAllByText("XP Eletrônicos").length).toBeGreaterThan(0);
    resolveRequest({
      ok: false,
      status: 429,
      json: async () => ({ data: null, error: { code: "RATE_LIMITED", message: "private" } }),
    } as Response);

    await waitFor(() => expect(button).toBeEnabled());
    expect(screen.getByRole("status")).toHaveTextContent("Aguarde um minuto antes de atualizar novamente.");
    expect(document.body).not.toHaveTextContent("private");
  });
});
