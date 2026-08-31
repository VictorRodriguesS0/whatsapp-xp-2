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

  it("renders sanitized product details with real product and selection actions", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    render(<CatalogPicker conversationId="conversation-one" onClose={vi.fn()} onSendCatalog={vi.fn()} open />);

    expect(screen.getByRole("complementary", { name: "Produtos do catálogo" })).toBeVisible();
    expect(screen.getByRole("searchbox", { name: "Buscar produtos" })).toBeVisible();
    expect(screen.getByRole("img", { name: "Controle sem fio" })).toHaveAttribute("src", "/api/catalog/products/CTRL-01/image");
    expect(screen.getByText("CTRL-01")).toBeVisible();
    expect(screen.getByText("BRL 199.90")).toBeVisible();
    expect(screen.getByText("Em estoque")).toBeVisible();
    expect(screen.getByText("Dados anteriores")).toBeVisible();
    expect(screen.getByRole("button", { name: "Enviar Controle sem fio" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Adicionar Controle sem fio à lista" })).toBeEnabled();
    expect(screen.queryByText("Disponível na próxima etapa")).not.toBeInTheDocument();
  });

  it("sends one product once and closes after success", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    let resolveSend!: (value: unknown) => void;
    const onSendCatalog = vi.fn().mockReturnValue(new Promise((resolve) => { resolveSend = resolve; }));
    const onClose = vi.fn();
    render(<CatalogPicker conversationId="conversation-one" onClose={onClose} onSendCatalog={onSendCatalog} open />);

    const send = screen.getByRole("button", { name: "Enviar Controle sem fio" });
    fireEvent.click(send);
    fireEvent.click(send);
    expect(onSendCatalog).toHaveBeenCalledTimes(1);
    expect(onSendCatalog).toHaveBeenCalledWith("PRODUCT", [catalogState.items[0]]);
    resolveSend({ id: "message-1" });
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("reviews an ordered selection and confirms the complete catalog", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const onSendCatalog = vi.fn().mockResolvedValue({ id: "message-1" });
    const onClose = vi.fn();
    const rendered = render(<CatalogPicker conversationId="conversation-one" onClose={onClose} onSendCatalog={onSendCatalog} open />);

    fireEvent.click(screen.getByRole("button", { name: "Adicionar Controle sem fio à lista" }));
    fireEvent.click(screen.getByRole("button", { name: "Revisar 1 produto selecionado" }));
    expect(screen.getByRole("region", { name: "Revisar envio do catálogo" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Enviar 1 produto" }));
    await vi.waitFor(() => expect(onSendCatalog).toHaveBeenCalledWith("PRODUCT_LIST", [catalogState.items[0]]));

    rendered.unmount();
    render(<CatalogPicker conversationId="conversation-one" onClose={onClose} onSendCatalog={onSendCatalog} open />);
    fireEvent.click(screen.getByRole("button", { name: "Enviar catálogo completo" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar envio do catálogo" }));
    await vi.waitFor(() => expect(onSendCatalog).toHaveBeenCalledWith("CATALOG", []));
  });

  it("renders as a full-height mobile sheet and closes with Escape", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const onClose = vi.fn();
    render(<CatalogPicker conversationId="conversation-one" onClose={onClose} onSendCatalog={vi.fn()} open />);
    const dialog = screen.getByRole("dialog", { name: "Produtos do catálogo" });
    expect(dialog).toHaveClass("fixed", "inset-0", "h-dvh");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("wires search, pagination, retry and accessible loading/empty states", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const rendered = render(<CatalogPicker conversationId="conversation-one" onClose={vi.fn()} onSendCatalog={vi.fn()} open />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar produtos" }), { target: { value: "cabo" } });
    expect(catalogState.setQuery).toHaveBeenCalledWith("cabo");
    fireEvent.click(screen.getByRole("button", { name: "Carregar mais produtos" }));
    expect(catalogState.loadMore).toHaveBeenCalledOnce();

    Object.assign(catalogState, { items: [], nextCursor: null, error: "Não foi possível carregar os produtos." });
    rendered.rerender(<CatalogPicker conversationId="conversation-one" onClose={vi.fn()} onSendCatalog={vi.fn()} open />);
    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível carregar os produtos.");
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(catalogState.retry).toHaveBeenCalledOnce();

    Object.assign(catalogState, { error: null, loading: true });
    rendered.rerender(<CatalogPicker conversationId="conversation-one" onClose={vi.fn()} onSendCatalog={vi.fn()} open />);
    expect(screen.getByRole("status")).toHaveTextContent("Carregando produtos");

    Object.assign(catalogState, { loading: false });
    rendered.rerender(<CatalogPicker conversationId="conversation-one" onClose={vi.fn()} onSendCatalog={vi.fn()} open />);
    expect(screen.getByText("Nenhum produto encontrado.")).toBeVisible();
  });
});
