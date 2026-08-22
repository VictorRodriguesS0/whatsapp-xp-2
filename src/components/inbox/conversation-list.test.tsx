import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ConversationListItem } from "@/modules/conversations/types";

import { ConversationList } from "./conversation-list";

const fixture: ConversationListItem = {
  id: "10000000-0000-4000-8000-000000000001",
  contact: {
    id: "20000000-0000-4000-8000-000000000001",
    profileName: "Carlos Lima",
    preferredName: null,
    name: "Carlos Lima",
    phone: "+55 61 99999-0001",
    type: null,
    tags: [],
  },
  responsible: { id: "30000000-0000-4000-8000-000000000001", name: "Marcos" },
  lastMessageAt: "2026-08-20T14:30:00.000Z",
  latestMessage: {
    id: "40000000-0000-4000-8000-000000000001",
    direction: "INBOUND",
    type: "TEXT",
    body: "Vocês têm esse modelo em estoque?",
    mediaObjectId: null,
    mediaState: null,
    sentBy: null,
    status: "RECEIVED",
    failureReason: null,
    externalTimestamp: "2026-08-20T14:30:00.000Z",
    createdAt: "2026-08-20T14:30:00.000Z",
  },
  unreadCount: 3,
  manuallyUnread: false,
  manualUnreadRevision: null,
  awaitingResponseSince: "2026-08-20T14:30:00.000Z",
  revision: "2026-08-20T14:30:00.000Z",
};

describe("ConversationList", () => {
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

  it("keeps shared unread state distinct from awaiting a response", () => {
    render(
      <ConversationList
        items={[
          { ...fixture, unreadCount: 0, manuallyUnread: true, awaitingResponseSince: null },
          { ...fixture, id: "10000000-0000-4000-8000-000000000002", unreadCount: 0, manuallyUnread: false },
        ]}
        selectedId={null}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Conversa marcada como não lida")).toBeVisible();
    expect(screen.getByText("Aguardando resposta")).toBeVisible();
    expect(screen.getAllByText("Aguardando resposta")).toHaveLength(1);
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
    expect(screen.getByText("Aguardando resposta")).toBeVisible();
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
});
