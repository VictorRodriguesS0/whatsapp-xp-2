import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ConversationListItem } from "@/modules/conversations/types";

import { CustomerPanel } from "./customer-panel";

const conversation: ConversationListItem = {
  id: "conversation-id",
  contact: {
    id: "contact-id",
    profileName: "Carlos",
    preferredName: null,
    name: "Carlos",
    phone: "5561999999999",
    type: null,
    tags: [],
  },
  responsible: null,
  lastMessageAt: "2026-08-20T14:30:00.000Z",
  latestMessage: null,
  unreadCount: 0,
  manuallyUnread: false,
  manualUnreadRevision: null,
  awaitingResponseSince: null,
  revision: "2026-08-20T14:30:00.000Z",
};

const availableTag = {
  id: "40000000-0000-4000-8000-000000000001",
  displayName: "Aguardando produto",
  color: "#176B52",
  position: 10,
  active: true,
};

const tagProps = {
  availableTags: [availableTag],
  tagsLoading: false,
  tagsError: null,
  tagSavePending: false,
  tagSaveError: null,
  onRetryTags: vi.fn(),
  onSaveTags: vi.fn().mockResolvedValue(true),
};

describe("CustomerPanel", () => {
  it("blocks assignment controls while an update is pending", () => {
    render(
      <CustomerPanel
        {...tagProps}
        conversation={conversation}
        currentUserId="user-id"
        onSetResponsible={vi.fn()}
        pending
        users={[{ id: "user-id", name: "Marcos", active: true }]}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Trocar responsável" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Assumir conversa" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Atualizando responsável");
  });

  it("shows textual assigned labels and wires the multi-label editor", async () => {
    const user = userEvent.setup();
    const onSaveTags = vi.fn().mockResolvedValue(true);
    render(
      <CustomerPanel
        {...tagProps}
        conversation={{
          ...conversation,
          contact: {
            ...conversation.contact,
            tags: [{ id: availableTag.id, name: availableTag.displayName, color: availableTag.color, active: true }],
          },
        }}
        currentUserId="user-id"
        onSaveTags={onSaveTags}
        onSetResponsible={vi.fn()}
        users={[]}
      />,
    );

    expect(screen.getByText(availableTag.displayName)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Gerenciar etiquetas" }));
    await user.click(screen.getByRole("checkbox", { name: availableTag.displayName }));
    await user.click(screen.getByRole("button", { name: "Salvar etiquetas" }));
    expect(onSaveTags).toHaveBeenCalledWith(conversation.contact.id, []);
  });

  it("keeps empty labels quiet and never applies an unsafe inline color", () => {
    const { rerender } = render(
      <CustomerPanel
        {...tagProps}
        conversation={conversation}
        currentUserId="user-id"
        onSetResponsible={vi.fn()}
        users={[]}
      />,
    );
    expect(screen.getByText("Nenhuma etiqueta aplicada")).toBeVisible();

    rerender(
      <CustomerPanel
        {...tagProps}
        conversation={{
          ...conversation,
          contact: {
            ...conversation.contact,
            tags: [{ id: "unsafe", name: "Importada", color: "url(javascript:bad)", active: true }],
          },
        }}
        currentUserId="user-id"
        onSetResponsible={vi.fn()}
        users={[]}
      />,
    );
    expect(screen.getByText("Importada").closest("span")).not.toHaveAttribute("style");
  });
});
