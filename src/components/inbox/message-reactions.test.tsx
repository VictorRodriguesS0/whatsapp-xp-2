import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { MessageDto } from "@/modules/conversations/types";

import { MessageReactions } from "./message-reactions";

const message: MessageDto = {
  id: "20000000-0000-4000-8000-000000000001",
  direction: "INBOUND",
  type: "TEXT",
  body: "Olá",
  content: null,
  canReply: false,
  replyTo: null,
  mediaObjectId: null,
  mediaState: null,
  sentBy: null,
  status: "RECEIVED",
  failureReason: null,
  revokedAt: null,
  reactions: [
    { id: "contact", reactor: "CONTACT", emoji: "👍", status: "SENT", sentBy: null },
    { id: "business", reactor: "BUSINESS", emoji: "❤️", status: "SENT", sentBy: { id: "user", name: "Ana" } },
  ],
  externalTimestamp: "2026-08-22T12:00:00.000Z",
  createdAt: "2026-08-22T12:00:00.000Z",
};

describe("MessageReactions", () => {
  it("labels customer and XP badges without exposing internal state", () => {
    render(<MessageReactions message={message} onReact={vi.fn()} />);
    expect(screen.getByLabelText("Cliente reagiu com 👍")).toBeVisible();
    expect(screen.getByLabelText("XP reagiu com ❤️, enviado por Ana")).toBeVisible();
  });

  it("shows the approved quick strip and sends the selected emoji", () => {
    const onReact = vi.fn();
    render(<MessageReactions message={{ ...message, reactions: [] }} onReact={onReact} />);
    fireEvent.click(screen.getByRole("button", { name: "Reagir à mensagem" }));
    for (const emoji of ["👍", "❤️", "😂", "😮", "😢", "🙏"]) {
      expect(screen.getByRole("button", { name: `Reagir com ${emoji}` })).toHaveClass("min-h-11");
    }
    fireEvent.click(screen.getByRole("button", { name: "Reagir com 😂" }));
    expect(onReact).toHaveBeenCalledWith(message.id, "😂");
  });

  it("uses the same business emoji as a removal toggle", () => {
    const onReact = vi.fn();
    render(<MessageReactions message={message} onReact={onReact} />);
    fireEvent.click(screen.getByRole("button", { name: "Reagir à mensagem" }));
    const remove = screen.getByRole("button", { name: "XP reagiu com ❤️, enviado por Ana" });
    expect(remove).toHaveClass("min-h-11", "min-w-11");
    expect(remove.firstElementChild).toHaveClass("min-h-7", "rounded-full");
    fireEvent.click(remove);
    expect(onReact).toHaveBeenCalledWith(message.id, "❤️");
  });

  it("announces pending and failed mutation state", () => {
    const { rerender } = render(
      <MessageReactions message={message} mutation={{ pending: true, error: null }} onReact={vi.fn()} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Enviando reação");
    rerender(
      <MessageReactions message={message} mutation={{ pending: false, error: "Falha na reação" }} onReact={vi.fn()} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Falha na reação");
  });

  it("uses the approved 767px mobile history boundary", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockImplementation((query: string) => ({
      matches: query === "(max-width: 767px)",
    })));
    render(<MessageReactions message={message} onReact={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Reagir à mensagem" }));

    expect(window.matchMedia).toHaveBeenCalledWith("(max-width: 767px)");
    expect(window.history.state).toMatchObject({ __xpReactionPicker: message.id });
    vi.unstubAllGlobals();
  });
});
