import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CatalogPicker } from "./catalog-picker";

const catalogState = vi.hoisted(() => ({
  query: "",
  setQuery: vi.fn(),
  items: [{
    retailerId: "CTRL-01",
    name: "Controle sem fio",
    description: "Controle para videogame",
    priceText: "BRL 199.90",
    availability: "IN_STOCK",
    availableToSend: true,
    imagePath: "/api/catalog/products/CTRL-01/image",
  }],
  nextCursor: "next",
  freshness: "STALE",
  loading: false,
  loadingMore: false,
  error: null,
  retry: vi.fn(),
  loadMore: vi.fn(),
}));

vi.mock("@/hooks/use-catalog-products", () => ({
  useCatalogProducts: () => catalogState,
}));

describe("CatalogPicker", () => {
  beforeEach(() => {
    Object.assign(catalogState, {
      query: "",
      items: [{
        retailerId: "CTRL-01",
        name: "Controle sem fio",
        description: "Controle para videogame",
        priceText: "BRL 199.90",
        availability: "IN_STOCK",
        availableToSend: true,
        imagePath: "/api/catalog/products/CTRL-01/image",
      }],
      nextCursor: "next",
      freshness: "STALE",
      loading: false,
      loadingMore: false,
      error: null,
    });
    vi.clearAllMocks();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("renders as a related desktop panel with sanitized product details and no send action", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    render(<CatalogPicker conversationId="conversation-one" onClose={vi.fn()} open />);

    expect(screen.getByRole("complementary", { name: "Produtos do catálogo" })).toBeVisible();
    expect(screen.getByRole("searchbox", { name: "Buscar produtos" })).toBeVisible();
    expect(screen.getByRole("img", { name: "Controle sem fio" })).toHaveAttribute("src", "/api/catalog/products/CTRL-01/image");
    expect(screen.getByText("CTRL-01")).toBeVisible();
    expect(screen.getByText("BRL 199.90")).toBeVisible();
    expect(screen.getByText("Em estoque")).toBeVisible();
    expect(screen.getByText("Dados anteriores")).toBeVisible();
    expect(screen.getByRole("button", { name: "Disponível na próxima etapa" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /enviar produto/i })).not.toBeInTheDocument();
  });

  it("renders as a full-height mobile sheet and closes with Escape", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const onClose = vi.fn();
    render(<CatalogPicker conversationId="conversation-one" onClose={onClose} open />);
    const dialog = screen.getByRole("dialog", { name: "Produtos do catálogo" });
    expect(dialog).toHaveClass("fixed", "inset-0", "h-dvh");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("wires search, pagination, retry and accessible loading/empty states", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const rendered = render(<CatalogPicker conversationId="conversation-one" onClose={vi.fn()} open />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar produtos" }), { target: { value: "cabo" } });
    expect(catalogState.setQuery).toHaveBeenCalledWith("cabo");
    fireEvent.click(screen.getByRole("button", { name: "Carregar mais produtos" }));
    expect(catalogState.loadMore).toHaveBeenCalledOnce();

    Object.assign(catalogState, { items: [], nextCursor: null, error: "Não foi possível carregar os produtos." });
    rendered.rerender(<CatalogPicker conversationId="conversation-one" onClose={vi.fn()} open />);
    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível carregar os produtos.");
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(catalogState.retry).toHaveBeenCalledOnce();

    Object.assign(catalogState, { error: null, loading: true });
    rendered.rerender(<CatalogPicker conversationId="conversation-one" onClose={vi.fn()} open />);
    expect(screen.getByRole("status")).toHaveTextContent("Carregando produtos");

    Object.assign(catalogState, { loading: false });
    rendered.rerender(<CatalogPicker conversationId="conversation-one" onClose={vi.fn()} open />);
    expect(screen.getByText("Nenhum produto encontrado.")).toBeVisible();
  });
});
