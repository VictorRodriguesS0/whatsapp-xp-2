import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ConversationListItem } from "@/modules/conversations/types";

import { CustomerPanel } from "./customer-panel";

const conversation: ConversationListItem = {
  id: "conversation-id",
  contact: { id: "contact-id", name: "Carlos", phone: "5561999999999", profilePictureUrl: null },
  responsible: null,
  lastMessageAt: "2026-08-20T14:30:00.000Z",
  latestMessage: null,
  unreadCount: 0,
};

describe("CustomerPanel", () => {
  it("blocks assignment controls while an update is pending", () => {
    render(
      <CustomerPanel
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
});
