import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MessageComposer } from "./message-composer";

describe("MessageComposer", () => {
  it("sends text with Enter and preserves Shift+Enter for a new line", () => {
    const sendText = vi.fn().mockResolvedValue(null);
    render(<MessageComposer onSendMedia={vi.fn()} onSendText={sendText} />);
    const message = screen.getByLabelText("Mensagem");
    fireEvent.change(message, { target: { value: "Olá" } });
    fireEvent.keyDown(message, { key: "Enter", shiftKey: true });
    expect(sendText).not.toHaveBeenCalled();
    fireEvent.keyDown(message, { key: "Enter" });
    expect(sendText).toHaveBeenCalledWith("Olá");
    expect(message).toHaveValue("");
  });

  it("previews an attachment and removes it without sending", () => {
    const sendMedia = vi.fn().mockResolvedValue(null);
    const { container } = render(<MessageComposer onSendMedia={sendMedia} onSendText={vi.fn()} />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [new File(["pdf"], "pedido.pdf", { type: "application/pdf" })] } });
    expect(screen.getByText("pedido.pdf")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Remover anexo" }));
    expect(screen.queryByText("pedido.pdf")).not.toBeInTheDocument();
    expect(sendMedia).not.toHaveBeenCalled();
  });
});
