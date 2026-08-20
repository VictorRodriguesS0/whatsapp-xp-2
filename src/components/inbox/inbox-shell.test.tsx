import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { SessionUser } from "@/modules/auth/session";

import { InboxShell } from "./inbox-shell";

vi.mock("@/hooks/use-inbox", () => ({
  useInbox: () => ({
    conversations: [{
      id: "conversation-id",
      contact: { id: "contact-id", name: "Carlos", phone: "5561999999999", profilePictureUrl: null },
      responsible: null,
      lastMessageAt: "2026-08-20T14:30:00.000Z",
      latestMessage: null,
      unreadCount: 1,
    }],
    conversation: null,
    users: [],
    selectedId: null,
    search: "",
    loadingList: false,
    loadingConversation: false,
    listError: null,
    conversationError: null,
    connected: true,
    setSearch: vi.fn(),
    openConversation: vi.fn(),
    closeConversation: vi.fn(),
    refreshList: vi.fn(),
    refreshConversation: vi.fn(),
    sendText: vi.fn(),
    sendMedia: vi.fn(),
    retryMessage: vi.fn(),
    setResponsible: vi.fn(),
  }),
}));

const user: SessionUser = { id: "user-id", name: "Marcos", email: "marcos@xp.test", role: "ATTENDANT" };

describe("InboxShell", () => {
  it("labels the main regions and keeps customer context available", () => {
    render(<InboxShell initialUser={user} />);
    expect(screen.getByRole("main", { name: "Central de atendimento" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Conversas" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Abrir dados do cliente" })).toBeVisible();
  });

  it("supports the mobile list-to-thread state and back action", () => {
    render(<InboxShell initialUser={user} />);
    fireEvent.click(screen.getByRole("button", { name: /Carlos/i }));
    expect(screen.getByTestId("inbox-shell")).toHaveAttribute("data-mobile-view", "thread");
    fireEvent.click(screen.getByRole("button", { name: "Voltar para conversas" }));
    expect(screen.getByTestId("inbox-shell")).toHaveAttribute("data-mobile-view", "list");
  });
});
