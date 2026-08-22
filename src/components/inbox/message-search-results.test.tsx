import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { MessageSearchResultDto } from "@/modules/message-search/types";

import { MessageSearchResults } from "./message-search-results";

const result: MessageSearchResultDto = {
  messageId: "30000000-0000-4000-8000-000000000001",
  conversationId: "20000000-0000-4000-8000-000000000001",
  direction: "INBOUND",
  type: "TEXT",
  externalTimestamp: "2026-08-22T12:00:00.000Z",
  snippet: "cliente pediu produto vermelho",
  matchedText: "produto",
  contact: {
    id: "40000000-0000-4000-8000-000000000001",
    name: "Ana Souza",
    phone: "+55 61 99999-0000",
  },
};

describe("MessageSearchResults", () => {
  it("renders searchable metadata and escaped highlighted text", () => {
    render(<MessageSearchResults items={[result]} query="produto" onSelect={vi.fn()} />);

    expect(screen.getByText("Ana Souza")).toBeInTheDocument();
    expect(screen.getByText("+55 61 99999-0000")).toBeInTheDocument();
    expect(screen.getByText("Recebida · Texto")).toBeInTheDocument();
    expect(screen.getByText("produto").tagName).toBe("MARK");
    expect(document.querySelector("[style]")).toBeNull();
  });

  it("selects a result and exposes paging, error, and empty states", () => {
    const onSelect = vi.fn();
    const onLoadMore = vi.fn();
    const { rerender } = render(
      <MessageSearchResults hasMore items={[result]} query="produto" onLoadMore={onLoadMore} onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Ana Souza.*cliente pediu produto vermelho/i }));
    expect(onSelect).toHaveBeenCalledWith(result);
    fireEvent.click(screen.getByRole("button", { name: "Carregar mais resultados" }));
    expect(onLoadMore).toHaveBeenCalled();

    rerender(<MessageSearchResults error="Falha segura" items={[]} query="produto" onRetry={vi.fn()} onSelect={onSelect} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Falha segura");
    expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeInTheDocument();

    rerender(<MessageSearchResults items={[]} query="produto" onSelect={onSelect} />);
    expect(screen.getByText("Nenhuma mensagem encontrada")).toBeInTheDocument();
  });

  it("shows an explicit loading state", () => {
    render(<MessageSearchResults items={[]} loading query="produto" onSelect={vi.fn()} />);
    expect(screen.getByText("Pesquisando mensagens")).toBeInTheDocument();
  });
});
