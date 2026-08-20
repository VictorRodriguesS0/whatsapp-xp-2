import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionUser } from "@/modules/auth/session";

import { InboxShell } from "./inbox-shell";

const useInboxMock = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/use-inbox", () => ({ useInbox: useInboxMock }));

const defaultInbox = {
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
  loadingMore: false,
  loadMoreError: null,
  nextCursor: null,
  responsiblePending: false,
  listError: null,
  conversationError: null,
  connected: true,
  setSearch: vi.fn(),
  openConversation: vi.fn(),
  closeConversation: vi.fn(),
  refreshList: vi.fn(),
  refreshConversation: vi.fn(),
  loadMore: vi.fn(),
  sendText: vi.fn(),
  sendMedia: vi.fn(),
  retryMessage: vi.fn(),
  markRead: vi.fn(),
  setResponsible: vi.fn(),
};

const user: SessionUser = { id: "user-id", name: "Marcos", email: "marcos@xp.test", role: "ATTENDANT" };

describe("InboxShell", () => {
  beforeEach(() => useInboxMock.mockReturnValue(defaultInbox));

  it("labels the main regions and keeps customer context available", () => {
    render(<InboxShell initialUser={user} />);
    expect(screen.getByRole("main", { name: "Central de atendimento" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Conversas" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Abrir dados do cliente" })).toBeVisible();
  });

  it("moves focus into the mobile thread and restores the selected conversation on back", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockImplementation((query: string) => ({ matches: query === "(max-width: 719px)" })));
    render(<InboxShell initialUser={user} />);
    const conversationButton = screen.getByRole("button", { name: /Carlos/i });
    fireEvent.click(conversationButton);
    expect(screen.getByTestId("inbox-shell")).toHaveAttribute("data-mobile-view", "thread");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Conversa" })).toHaveFocus());

    fireEvent.click(screen.getByRole("button", { name: "Voltar para conversas" }));
    expect(screen.getByTestId("inbox-shell")).toHaveAttribute("data-mobile-view", "list");
    await waitFor(() => expect(conversationButton).toHaveFocus());
    vi.unstubAllGlobals();
  });

  it("does not move focus away from the conversation button on desktop", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
    render(<InboxShell initialUser={user} />);
    const conversationButton = screen.getByRole("button", { name: /Carlos/i });
    conversationButton.focus();

    fireEvent.click(conversationButton);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(conversationButton).toHaveFocus();
    vi.unstubAllGlobals();
  });

  it("prefers fresh selected conversation metadata over a stale list row", () => {
    useInboxMock.mockReturnValue({
      ...defaultInbox,
      selectedId: "conversation-id",
      conversation: {
        ...defaultInbox.conversations[0],
        responsible: { id: "new-user", name: "Responsável atual" },
        createdAt: "2026-08-20T14:30:00.000Z",
        updatedAt: "2026-08-20T14:31:00.000Z",
        messages: [],
        lastReadMessageId: null,
        lastReadAt: null,
      },
    });

    render(<InboxShell initialUser={user} />);

    const panel = screen.getByRole("complementary", { name: "Dados do cliente" });
    expect(within(panel).getAllByText("Responsável atual")).not.toHaveLength(0);
    expect(within(panel).queryByText("Sem responsável")).not.toBeInTheDocument();
  });
});
