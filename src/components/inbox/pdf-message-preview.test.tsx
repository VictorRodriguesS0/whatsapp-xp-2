import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PdfMessagePreview } from "./pdf-message-preview";

const mediaId = "50000000-0000-4000-8000-000000000001";

describe("PdfMessagePreview", () => {
  it("shows the authenticated first-page preview and opens the full PDF", () => {
    const onOpen = vi.fn();
    render(<PdfMessagePreview filename="Nota fiscal.pdf" mediaId={mediaId} onOpen={onOpen} />);

    const button = screen.getByRole("button", { name: "Abrir PDF Nota fiscal.pdf" });
    const image = screen.getByRole("img", { name: "Prévia da primeira página de Nota fiscal.pdf" });
    expect(button).toHaveClass("min-h-11");
    expect(button).toHaveClass("bg-[var(--media-surface)]", "hover:bg-[var(--media-surface-hover)]");
    expect(image).toHaveAttribute("src", `/api/media/${mediaId}/thumbnail`);
    expect(screen.getByRole("status", { name: "Carregando prévia do PDF" })).toBeInTheDocument();

    fireEvent.load(image);
    expect(screen.queryByRole("status", { name: "Carregando prévia do PDF" })).toBeNull();
    expect(screen.getByText("PDF")).toBeVisible();
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("falls back to the same accessible document action when the thumbnail fails", () => {
    const onOpen = vi.fn();
    render(<PdfMessagePreview filename="Manual.pdf" mediaId={mediaId} onOpen={onOpen} />);

    fireEvent.error(screen.getByRole("img"));

    expect(screen.queryByRole("img")).toBeNull();
    const button = screen.getByRole("button", { name: "Abrir PDF Manual.pdf" });
    expect(button).toHaveClass("bg-[var(--media-surface)]", "hover:bg-[var(--media-surface-hover)]");
    expect(button).toHaveTextContent("Manual.pdf");
    expect(button).toHaveTextContent("PDF");
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("forwards the opening button ref for dialog focus restoration", () => {
    let target: HTMLButtonElement | null = null;
    render(
      <PdfMessagePreview
        buttonRef={(element) => { target = element; }}
        filename="Garantia.pdf"
        mediaId={mediaId}
        onOpen={() => undefined}
      />,
    );

    expect(target).toBe(screen.getByRole("button", { name: "Abrir PDF Garantia.pdf" }));
  });
});
