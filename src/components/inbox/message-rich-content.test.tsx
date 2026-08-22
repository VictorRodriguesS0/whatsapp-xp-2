import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { InboxMessage } from "@/hooks/use-inbox";

import { MessageRichContent } from "./message-rich-content";

const baseMessage: InboxMessage = {
  id: "40000000-0000-4000-8000-000000000010",
  direction: "INBOUND",
  type: "LOCATION",
  body: null,
  content: null,
  canReply: false,
  replyTo: null,
  mediaObjectId: null,
  mediaState: null,
  sentBy: null,
  status: "RECEIVED",
  failureReason: null,
  revokedAt: null,
  reactions: [],
  externalTimestamp: "2026-08-21T15:00:00.000Z",
  createdAt: "2026-08-21T15:00:00.000Z",
};

const locationMessage: InboxMessage = {
  ...baseMessage,
  content: {
    kind: "location",
    latitude: -15.793889,
    longitude: -47.882778,
    name: "XP Eletrônicos",
    address: "Brasília, DF",
  },
};

const contactsMessage: InboxMessage = {
  ...baseMessage,
  type: "CONTACTS",
  content: {
    kind: "contacts",
    contacts: [
      {
        name: "Maria Silva",
        phones: [{ phone: "+55 61 99999-0000", type: "Celular" }],
      },
    ],
    truncated: false,
  },
};

const buttonMessage: InboxMessage = {
  ...baseMessage,
  type: "INTERACTIVE",
  content: {
    kind: "interactive",
    interaction: "button",
    id: "private-button-id",
    title: "Quero comprar",
  },
};

const listMessage: InboxMessage = {
  ...buttonMessage,
  content: {
    kind: "interactive",
    interaction: "list",
    id: "private-list-id",
    title: "Assistência técnica",
  },
};

const orderMessage: InboxMessage = {
  ...baseMessage,
  type: "ORDER",
  content: { kind: "order", catalogId: "private-catalog-id", productCount: 2 },
};

const systemMessage: InboxMessage = {
  ...baseMessage,
  type: "SYSTEM",
  content: { kind: "system", text: "Número alterado" },
};

const unknownMessage: InboxMessage = {
  ...baseMessage,
  type: "UNSUPPORTED",
  content: { kind: "unknown", rawType: "reaction" },
};

describe("MessageRichContent", () => {
  it("renders location and a safe Maps link", () => {
    render(<MessageRichContent message={locationMessage} />);

    expect(screen.getByText("XP Eletrônicos")).toBeVisible();
    expect(screen.getByText("Brasília, DF")).toBeVisible();
    expect(screen.getByText("-15.793889, -47.882778")).toBeVisible();
    const mapsLink = screen.getByRole("link", { name: "Abrir no Google Maps" });
    expect(mapsLink).toHaveAttribute(
      "href",
      "https://www.google.com/maps/search/?api=1&query=-15.793889%2C-47.882778",
    );
    expect(mapsLink).toHaveAttribute("target", "_blank");
    expect(mapsLink).toHaveAttribute("rel", "noopener noreferrer");
    expect(mapsLink).toHaveClass("min-h-11");
  });

  it("renders shared contacts without an import action", () => {
    render(<MessageRichContent message={contactsMessage} />);

    expect(screen.getByText("Maria Silva")).toBeVisible();
    expect(screen.getByText("+55 61 99999-0000")).toBeVisible();
    expect(screen.getByText("Celular")).toBeVisible();
    expect(screen.queryByRole("button", { name: /importar|salvar/i })).toBeNull();
  });

  it("announces when validated contacts were truncated", () => {
    render(
      <MessageRichContent
        message={{
          ...contactsMessage,
          content: {
            kind: "contacts",
            contacts: [
              {
                name: "Maria Silva",
                phones: [{ phone: "+55 61 99999-0000", type: "Celular" }],
              },
            ],
            truncated: true,
          },
        }}
      />,
    );

    expect(screen.getByText("Alguns contatos não foram exibidos.")).toBeVisible();
  });

  it.each([
    [buttonMessage, "Resposta de botão", "Quero comprar"],
    [listMessage, "Resposta de lista", "Assistência técnica"],
    [orderMessage, "Pedido recebido", "2 produtos"],
    [systemMessage, "Atualização do WhatsApp", "Número alterado"],
    [unknownMessage, "Mensagem do tipo reação ainda não disponível", null],
  ])("renders safe rich content", (message, heading, text) => {
    render(<MessageRichContent message={message} />);

    expect(screen.getByText(heading)).toBeVisible();
    if (text) expect(screen.getByText(text)).toBeVisible();
    expect(screen.queryByText(/private-button-id|private-list-id|private-catalog-id|token|payload|filesystem/i)).toBeNull();
  });

  it("uses a safe generic copy for unknown provider types", () => {
    render(
      <MessageRichContent
        message={{
          ...unknownMessage,
          content: { kind: "unknown", rawType: "filesystem_token" },
        }}
      />,
    );

    expect(screen.getByText("Mensagem ainda não disponível.")).toBeVisible();
    expect(screen.queryByText(/filesystem|token/i)).toBeNull();
  });

  it("falls back when content is malformed or mismatched with the explicit type", () => {
    const malformed = {
      ...baseMessage,
      content: {
        kind: "location",
        latitude: 200,
        longitude: -47.882778,
        name: "private payload",
        address: null,
      },
    } as unknown as InboxMessage;
    const view = render(<MessageRichContent message={malformed} />);

    expect(screen.getByRole("status")).toHaveTextContent("Conteúdo desta mensagem indisponível.");
    expect(screen.queryByText(/private|payload/i)).toBeNull();

    view.rerender(<MessageRichContent message={{ ...contactsMessage, type: "LOCATION" }} />);
    expect(screen.getByRole("status")).toHaveTextContent("Conteúdo desta mensagem indisponível.");
    expect(screen.queryByText("Maria Silva")).toBeNull();
  });
});
