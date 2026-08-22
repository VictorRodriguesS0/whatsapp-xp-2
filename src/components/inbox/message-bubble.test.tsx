import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { MessageDto } from "@/modules/conversations/types";

import { MessageBubble } from "./message-bubble";

const outboundFixture: MessageDto = {
  id: "40000000-0000-4000-8000-000000000002",
  direction: "OUTBOUND",
  type: "TEXT",
  body: "Temos disponível sim.",
  content: null,
  canReply: false,
  replyTo: null,
  mediaObjectId: null,
  mediaState: null,
  sentBy: { id: "30000000-0000-4000-8000-000000000001", name: "Marcos" },
  status: "DELIVERED",
  failureReason: null,
  externalTimestamp: "2026-08-20T14:31:00.000Z",
  createdAt: "2026-08-20T14:31:00.000Z",
};

describe("MessageBubble", () => {
  it("offers an accessible reply action only for replyable messages", () => {
    const reply = vi.fn();
    const { rerender } = render(
      <MessageBubble
        message={{ ...outboundFixture, canReply: true }}
        onReply={reply}
      />,
    );

    const action = screen.getByRole("button", { name: "Responder à mensagem" });
    expect(action).toHaveClass("min-h-11", "min-w-11");
    expect(action).toHaveClass("opacity-100", "min-[720px]:opacity-0");
    expect(action).not.toHaveClass("sm:opacity-0");
    fireEvent.click(action);
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ id: outboundFixture.id }));

    rerender(<MessageBubble message={outboundFixture} onReply={reply} />);
    expect(screen.queryByRole("button", { name: "Responder à mensagem" }))
      .not.toBeInTheDocument();
  });

  it("renders a quoted preview before the message body and navigates to it", () => {
    const navigate = vi.fn();
    render(
      <MessageBubble
        message={{
          ...outboundFixture,
          replyTo: {
            available: true,
            messageId: "40000000-0000-4000-8000-000000000001",
            direction: "INBOUND",
            type: "TEXT",
            author: "Cliente",
            summary: "Tem esse produto?",
          },
        }}
        onNavigateReply={navigate}
      />,
    );

    const preview = screen.getByRole("button", { name: /^Ir para mensagem original/ });
    const body = screen.getByText(outboundFixture.body!);
    expect(preview.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
    fireEvent.click(preview);
    expect(navigate).toHaveBeenCalledWith("40000000-0000-4000-8000-000000000001");
  });

  it("registers a focusable article and exposes reduced-motion-safe highlight state", () => {
    const register = vi.fn();
    const { unmount } = render(
      <MessageBubble
        highlighted
        message={outboundFixture}
        registerElement={register}
      />,
    );

    const article = screen.getByText(outboundFixture.body!).closest("article");
    expect(article).toHaveAttribute("tabindex", "-1");
    expect(article).toHaveAttribute("data-highlighted", "true");
    expect(register).toHaveBeenCalledWith(outboundFixture.id, article);
    unmount();
    expect(register).toHaveBeenLastCalledWith(outboundFixture.id, null);
  });

  it("labels an outbound message with its internal sender", () => {
    render(<MessageBubble message={outboundFixture} />);

    expect(screen.getByText("Marcos")).toBeVisible();
    expect(screen.getByText("Temos disponível sim.")).toBeVisible();
    expect(screen.queryByText("Marcos: Temos disponível sim.")).not.toBeInTheDocument();
  });

  it("labels an outbound WhatsApp Business app message without an internal sender as WhatsApp", () => {
    render(<MessageBubble message={{ ...outboundFixture, sentBy: null }} />);

    expect(screen.getByText("WhatsApp")).toBeVisible();
  });

  it("does not render an author label for an inbound message without an internal sender", () => {
    render(<MessageBubble message={{ ...outboundFixture, direction: "INBOUND", sentBy: null, status: "RECEIVED" }} />);

    expect(screen.queryByText("Marcos")).not.toBeInTheDocument();
    expect(screen.queryByText("WhatsApp")).not.toBeInTheDocument();
  });

  it.each([
    ["PENDING", "Enviando"],
    ["SENT", "Enviada"],
    ["DELIVERED", "Entregue"],
    ["READ", "Lida"],
  ] as const)("describes %s status as %s", (status, label) => {
    render(<MessageBubble message={{ ...outboundFixture, status }} />);
    expect(screen.getByText(label)).toBeVisible();
  });

  it("keeps a failed message in place and retries the same row", () => {
    const retry = vi.fn();
    render(
      <MessageBubble
        message={{
          ...outboundFixture,
          clientRequestId: "11111111-1111-4111-8111-111111111111",
          status: "FAILED",
          failureReason: "Falha temporária",
        }}
        onRetry={retry}
      />,
    );

    expect(screen.getByText("Falha ao enviar")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Tentar enviar novamente" }));
    expect(retry).toHaveBeenCalledWith(outboundFixture.id);
  });

  it("keeps an actorless external failure safe without offering retry", () => {
    render(
      <MessageBubble
        message={{ ...outboundFixture, clientRequestId: null, sentBy: null, status: "FAILED" }}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText("Não foi possível enviar esta mensagem.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Tentar enviar novamente" })).not.toBeInTheDocument();
  });

  it("does not expose provider failure details", () => {
    render(
      <MessageBubble
        message={{ ...outboundFixture, status: "FAILED", failureReason: "Graph OAuthException code 131047" }}
      />,
    );

    expect(screen.getByText("Não foi possível enviar esta mensagem.")).toBeVisible();
    expect(screen.queryByText(/Graph|OAuthException|131047/i)).not.toBeInTheDocument();
  });

  it("uses the authenticated media route", () => {
    render(
      <MessageBubble
        message={{
          ...outboundFixture,
          type: "IMAGE",
          body: "Produto",
          mediaObjectId: "media-id",
          mediaState: { status: "AVAILABLE", nextAttemptAt: null, canRetry: false },
        }}
      />,
    );
    expect(screen.getByRole("img", { name: "Produto" })).toHaveAttribute("src", "/api/media/media-id");
  });

  it("renders structured content inside the existing mobile-width bubble", () => {
    render(
      <MessageBubble
        message={{
          ...outboundFixture,
          direction: "INBOUND",
          type: "LOCATION",
          body: null,
          content: {
            kind: "location",
            latitude: -15.793889,
            longitude: -47.882778,
            name: "XP Eletrônicos",
            address: null,
          },
          sentBy: null,
          status: "RECEIVED",
        }}
      />,
    );

    expect(screen.getByRole("link", { name: "Abrir no Google Maps" })).toBeVisible();
    expect(screen.getByText("XP Eletrônicos").closest("article")?.firstElementChild).toHaveClass(
      "max-w-[min(78%,42rem)]",
    );
  });
});
