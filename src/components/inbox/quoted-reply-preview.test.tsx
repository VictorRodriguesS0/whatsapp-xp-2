import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { QuotedReplyDto } from "@/modules/messages/reply-context";

import { QuotedReplyPreview } from "./quoted-reply-preview";

const availableReply: QuotedReplyDto = {
  available: true,
  messageId: "11111111-1111-4111-8111-111111111111",
  direction: "INBOUND",
  type: "TEXT",
  author: "Cliente",
  summary: "Tem esse produto?",
};

describe("QuotedReplyPreview", () => {
  it("renders a bounded navigation action for an available original", () => {
    const navigate = vi.fn();
    render(<QuotedReplyPreview onNavigate={navigate} reply={availableReply} />);

    expect(screen.getByText("Cliente")).toBeVisible();
    expect(screen.getByText("Tem esse produto?")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Ir para mensagem original" }));
    expect(navigate).toHaveBeenCalledWith(availableReply.messageId);
  });

  it("renders an unavailable original as text without a navigation action", () => {
    render(<QuotedReplyPreview onNavigate={vi.fn()} reply={{ available: false }} />);

    expect(screen.getByText("Mensagem original indisponível")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Ir para mensagem original" }))
      .not.toBeInTheDocument();
  });

  it("keeps cancel separate, labelled and at least 44px tall", () => {
    const cancel = vi.fn();
    render(<QuotedReplyPreview onCancel={cancel} reply={availableReply} />);

    const action = screen.getByRole("button", { name: "Cancelar resposta citada" });
    expect(action).toHaveClass("min-h-11", "min-w-11");
    fireEvent.click(action);
    expect(cancel).toHaveBeenCalledOnce();
  });
});
