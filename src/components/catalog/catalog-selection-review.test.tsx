import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CatalogSelectionReview } from "./catalog-selection-review";

const products = [
  { retailerId: "XP-2", name: "Headset", description: null, priceText: "BRL 200.00", availability: "IN_STOCK" as const, availableToSend: true, imagePath: null },
  { retailerId: "XP-1", name: "Controle", description: null, priceText: "BRL 100.00", availability: "IN_STOCK" as const, availableToSend: true, imagePath: null },
];

describe("CatalogSelectionReview", () => {
  it("preserves product order, removes items and confirms explicitly", () => {
    const onRemove = vi.fn();
    const onConfirm = vi.fn();
    render(<CatalogSelectionReview error={null} mode="PRODUCT_LIST" onCancel={vi.fn()} onConfirm={onConfirm} onRemove={onRemove} pending={false} products={products} />);

    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Headset");
    expect(items[1]).toHaveTextContent("Controle");
    fireEvent.click(screen.getByRole("button", { name: "Remover Headset" }));
    expect(onRemove).toHaveBeenCalledWith("XP-2");
    fireEvent.click(screen.getByRole("button", { name: "Enviar 2 produtos" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("requires confirmation for the complete catalog and closes with Escape", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(<CatalogSelectionReview error={null} mode="CATALOG" onCancel={onCancel} onConfirm={onConfirm} onRemove={vi.fn()} pending={false} products={[]} />);

    expect(screen.getByText("Enviar catálogo completo?")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar envio do catálogo" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    fireEvent.keyDown(screen.getByRole("region", { name: "Revisar envio do catálogo" }), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("disables duplicate confirmation while pending and announces a safe error", () => {
    render(<CatalogSelectionReview error="Um produto não está mais disponível." mode="PRODUCT_LIST" onCancel={vi.fn()} onConfirm={vi.fn()} onRemove={vi.fn()} pending products={products} />);
    expect(screen.getByRole("button", { name: "Enviando produtos" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Um produto não está mais disponível.");
  });
});
