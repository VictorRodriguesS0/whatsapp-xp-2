import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { MessageDto } from "@/modules/conversations/types";

import { MessageBubble } from "./message-bubble";

const outboundFixture: MessageDto = {
  id: "40000000-0000-4000-8000-000000000002",
  direction: "OUTBOUND",
  type: "TEXT",
  body: "Temos disponível sim.",
  mediaObjectId: null,
  sentBy: { id: "30000000-0000-4000-8000-000000000001", name: "Marcos" },
  status: "DELIVERED",
  failureReason: null,
  externalTimestamp: "2026-08-20T14:31:00.000Z",
  createdAt: "2026-08-20T14:31:00.000Z",
};

describe("MessageBubble", () => {
  it("labels an outbound message with the internal sender only", () => {
    render(<MessageBubble message={outboundFixture} />);

    expect(screen.getByText("Marcos")).toBeVisible();
    expect(screen.getByText("Temos disponível sim.")).toBeVisible();
    expect(screen.queryByText("Marcos: Temos disponível sim.")).not.toBeInTheDocument();
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
        message={{ ...outboundFixture, status: "FAILED", failureReason: "Falha temporária" }}
        onRetry={retry}
      />,
    );

    expect(screen.getByText("Falha ao enviar")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Tentar enviar novamente" }));
    expect(retry).toHaveBeenCalledWith(outboundFixture.id);
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
        message={{ ...outboundFixture, type: "IMAGE", body: "Produto", mediaObjectId: "media-id" }}
      />,
    );
    expect(screen.getByRole("img", { name: "Produto" })).toHaveAttribute("src", "/api/media/media-id");
  });
});
