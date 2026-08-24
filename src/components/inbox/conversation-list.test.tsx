import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ConversationListItem, MessageDto } from "@/modules/conversations/types";

import { ConversationList, richMessagePreview } from "./conversation-list";

const fixture: ConversationListItem = {
  id: "10000000-0000-4000-8000-000000000001",
  contact: {
    id: "20000000-0000-4000-8000-000000000001",
    profileName: "Carlos Lima",
    preferredName: null,
    name: "Carlos Lima",
    phone: "+55 61 99999-0001",
    messagingRestricted: false,
    type: null,
    tags: [],
  },
  responsible: { id: "30000000-0000-4000-8000-000000000001", name: "Marcos" },
  pinnedAt: null,
  lastMessageAt: "2026-08-20T14:30:00.000Z",
  latestMessage: {
    id: "40000000-0000-4000-8000-000000000001",
    direction: "INBOUND",
    type: "TEXT",
    body: "Vocês têm esse modelo em estoque?",
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
    externalTimestamp: "2026-08-20T14:30:00.000Z",
    createdAt: "2026-08-20T14:30:00.000Z",
  },
  unreadCount: 3,
  manuallyUnread: false,
  manualUnreadRevision: null,
  revision: "2026-08-20T14:30:00.000Z",
};

const richPreviewCases: Array<[
  MessageDto["type"],
  MessageDto["content"],
  string,
]> = [
  ["STICKER", null, "Figurinha"],
  ["LOCATION", { kind: "location", latitude: -15.793889, longitude: -47.882778, name: null, address: null }, "Localização"],
  ["CONTACTS", { kind: "contacts", contacts: [{ name: "Maria", phones: [] }], truncated: false }, "Contato compartilhado"],
  ["INTERACTIVE", { kind: "interactive", interaction: "list", id: "private-id", title: "Assistência técnica" }, "Assistência técnica"],
  ["ORDER", { kind: "order", catalogId: null, productCount: 2 }, "Pedido recebido"],
  ["SYSTEM", { kind: "system", text: "Número alterado" }, "Atualização do WhatsApp"],
];

describe("ConversationList", () => {
  it("shows one distinct contact type without disturbing queue indicators", () => {
    const { rerender } = render(
      <ConversationList
        items={[{
          ...fixture,
          contact: {
            ...fixture.contact,
            type: {
              id: "type-1",
              name: "Cliente",
              color: "#176B52",
              active: true,
            },
          },
        }]}
        selectedId={null}
        onSelect={vi.fn()}
      />,
    );

    const marker = screen.getByLabelText("Tipo de contato de Carlos Lima");
    expect(within(marker).getAllByText("Cliente")).toHaveLength(1);
    expect(screen.getByLabelText("3 mensagens não lidas")).toBeVisible();
    expect(screen.queryByText("Aguardando resposta")).not.toBeInTheDocument();
    expect(screen.getByText("Marcos")).toBeVisible();

    rerender(
      <ConversationList items={[fixture]} selectedId={null} onSelect={vi.fn()} />,
    );
    expect(screen.queryByLabelText("Tipo de contato de Carlos Lima")).not.toBeInTheDocument();
  });

  it("does not apply an unsafe type color to the conversation row", () => {
    render(
      <ConversationList
        items={[{
          ...fixture,
          contact: {
            ...fixture.contact,
            type: {
              id: "type-unsafe",
              name: "Importado",
              color: "url(javascript:bad)",
              active: true,
            },
          },
        }]}
        selectedId={null}
        onSelect={vi.fn()}
      />,
    );

    expect(
      within(screen.getByLabelText("Tipo de contato de Carlos Lima"))
        .getByText("Importado"),
    ).not.toHaveAttribute("style");
  });

  it("shows unread count and the responsible employee", () => {
    render(<ConversationList items={[fixture]} selectedId={null} onSelect={vi.fn()} />);

    expect(screen.getByText("3")).toBeVisible();
    expect(screen.getByText("Marcos")).toBeVisible();
  });

  it("shows two compact textual labels and an accessible overflow count", () => {
    render(
      <ConversationList
        items={[{
          ...fixture,
          contact: {
            ...fixture.contact,
            tags: [
              { id: "tag-1", name: "VIP", color: "#176B52", active: true },
              { id: "tag-2", name: "Aguardando produto", color: "#2458A6", active: true },
              { id: "tag-3", name: "Loja", color: "#B4443C", active: true },
              { id: "tag-4", name: "Retorno", color: "url(javascript:bad)", active: true },
            ],
          },
        }]}
        selectedId={null}
        onSelect={vi.fn()}
      />,
    );

    const row = screen.getByRole("button", { name: /Carlos Lima/i });
    expect(row).toHaveTextContent("VIP");
    expect(row).toHaveTextContent("Aguardando produto");
    expect(row).not.toHaveTextContent("Loja");
    expect(screen.getByLabelText("Mais 2 etiquetas")).toHaveTextContent("+2");
  });

  it("does not add a label row when the contact has no labels", () => {
    render(<ConversationList items={[fixture]} selectedId={null} onSelect={vi.fn()} />);

    expect(screen.queryByLabelText("Etiquetas de Carlos Lima")).not.toBeInTheDocument();
  });

  it("keeps shared unread state without the generic awaiting-response marker", () => {
    render(
      <ConversationList
        items={[
          { ...fixture, unreadCount: 0, manuallyUnread: true },
          { ...fixture, id: "10000000-0000-4000-8000-000000000002", unreadCount: 0, manuallyUnread: false },
        ]}
        selectedId={null}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Conversa marcada como não lida")).toBeVisible();
    expect(screen.queryByText("Aguardando resposta")).not.toBeInTheDocument();
  });

  it("describes pending media without merging its state with unread or response indicators", () => {
    render(
      <ConversationList
        items={[{
          ...fixture,
          latestMessage: {
            ...fixture.latestMessage!,
            type: "AUDIO",
            body: null,
            mediaObjectId: "50000000-0000-4000-8000-000000000001",
            mediaState: { status: "PENDING", nextAttemptAt: "2099-08-21T15:00:00.000Z", canRetry: false },
          },
        }]}
        selectedId={null}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText("Baixando áudio")).toBeVisible();
    expect(screen.queryByText("Aguardando resposta")).not.toBeInTheDocument();
    expect(screen.getByLabelText("3 mensagens não lidas")).toBeVisible();
  });

  it("exposes the selected conversation and a 44px interaction target", () => {
    const onSelect = vi.fn();
    render(<ConversationList items={[fixture]} selectedId={fixture.id} onSelect={onSelect} />);

    const conversation = screen.getByRole("button", { name: /Carlos Lima/i });
    expect(conversation).toHaveAttribute("aria-current", "true");
    expect(conversation).toHaveClass("min-h-11");
    fireEvent.click(conversation);
    expect(onSelect).toHaveBeenCalledWith(fixture.id);
  });

  it("fixes and unfixes a conversation without opening it", () => {
    const onSelect = vi.fn();
    const onSetPinned = vi.fn();
    const { rerender } = render(
      <ConversationList
        items={[fixture]}
        selectedId={null}
        onSelect={onSelect}
        onSetPinned={onSetPinned}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Fixar conversa de Carlos Lima" }));
    expect(onSetPinned).toHaveBeenCalledWith(fixture.id, true);
    expect(onSelect).not.toHaveBeenCalled();

    rerender(
      <ConversationList
        items={[{ ...fixture, pinnedAt: "2026-08-23T13:45:00.000Z" }]}
        selectedId={null}
        onSelect={onSelect}
        onSetPinned={onSetPinned}
        pinPendingIds={new Set([fixture.id])}
      />,
    );

    const unpin = screen.getByRole("button", { name: "Desfixar conversa de Carlos Lima" });
    expect(unpin).toBeDisabled();
    expect(unpin).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Conversa fixada")).toBeVisible();
  });

  it("shows a pin failure without hiding the conversation list", () => {
    render(
      <ConversationList
        items={[fixture]}
        selectedId={null}
        onSelect={vi.fn()}
        pinError="Não foi possível atualizar a fixação da conversa."
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Não foi possível atualizar a fixação da conversa.",
    );
    expect(screen.getByRole("button", { name: /Carlos Lima/i })).toBeVisible();
  });

  it("renders useful loading, empty and error states", () => {
    const { rerender } = render(
      <ConversationList items={[]} selectedId={null} onSelect={vi.fn()} loading />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Carregando conversas");

    rerender(
      <ConversationList items={[]} selectedId={null} onSelect={vi.fn()} search="Carlos" />,
    );
    expect(screen.getByText("Nenhuma conversa encontrada")).toBeVisible();

    rerender(
      <ConversationList
        items={[]}
        selectedId={null}
        onSelect={vi.fn()}
        error="Não foi possível carregar as conversas."
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível carregar");
    expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeVisible();
  });

  it("keeps existing conversations visible when a refresh fails", () => {
    render(
      <ConversationList
        error="Conexão interrompida."
        items={[fixture]}
        onRetry={vi.fn()}
        onSelect={vi.fn()}
        selectedId={null}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Conexão interrompida.");
    expect(screen.getByRole("button", { name: /Carlos Lima/i })).toBeVisible();
  });

  it("loads and retries older conversations without hiding the current page", () => {
    const loadMore = vi.fn();
    const { rerender } = render(
      <ConversationList
        hasMore
        items={[fixture]}
        loadingMore
        onLoadMore={loadMore}
        onSelect={vi.fn()}
        selectedId={null}
      />,
    );

    expect(screen.getByRole("button", { name: "Carregando conversas anteriores" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Carlos Lima/i })).toBeVisible();

    rerender(
      <ConversationList
        hasMore
        items={[fixture]}
        loadMoreError="Não foi possível carregar conversas anteriores."
        onLoadMore={loadMore}
        onSelect={vi.fn()}
        selectedId={null}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Tentar carregar novamente" }));
    expect(loadMore).toHaveBeenCalledOnce();
  });

  it.each(richPreviewCases)("builds a useful %s list preview", (type, content, expected) => {
    expect(richMessagePreview({ ...fixture.latestMessage!, type, body: null, content })).toBe(expected);
  });

  it("does not expose an interactive title until its content passes validation", () => {
    const malformed = {
      ...fixture.latestMessage!,
      type: "INTERACTIVE",
      body: null,
      content: {
        kind: "interactive",
        interaction: "list",
        id: "",
        title: "private payload title",
        extra: "token",
      },
    } as unknown as NonNullable<ConversationListItem["latestMessage"]>;

    expect(richMessagePreview(malformed)).toBe("Resposta interativa");
    render(
      <ConversationList
        items={[{ ...fixture, latestMessage: malformed }]}
        selectedId={null}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("Resposta interativa")).toBeVisible();
    expect(screen.queryByText(/private|payload|token/i)).toBeNull();
  });

  it("preserves media state priority and ordinary caption precedence", () => {
    const image = {
      ...fixture.latestMessage!,
      type: "IMAGE" as const,
      body: "Produto em estoque",
      mediaObjectId: "50000000-0000-4000-8000-000000000001",
      mediaState: { status: "AVAILABLE" as const, nextAttemptAt: null, canRetry: false },
    };
    const view = render(
      <ConversationList
        items={[{ ...fixture, latestMessage: image }]}
        selectedId={null}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("Produto em estoque")).toBeVisible();

    view.rerender(
      <ConversationList
        items={[{
          ...fixture,
          latestMessage: {
            ...image,
            mediaState: { status: "PENDING", nextAttemptAt: null, canRetry: false },
          },
        }]}
        selectedId={null}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("Baixando imagem")).toBeVisible();
    expect(screen.queryByText("Produto em estoque")).toBeNull();
  });
});
