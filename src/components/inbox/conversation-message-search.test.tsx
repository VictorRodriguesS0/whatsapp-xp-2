import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConversationMessageSearch } from "./conversation-message-search";

const search = vi.hoisted(() => ({
  query: "produto",
  setQuery: vi.fn(),
  items: [
    { messageId: "30000000-0000-4000-8000-000000000001", conversationId: "conversation-id", snippet: "um produto", matchedText: "produto", direction: "INBOUND", type: "TEXT", externalTimestamp: "2026-08-22T12:00:00Z", contact: { id: "contact", name: "Ana", phone: "1" } },
    { messageId: "30000000-0000-4000-8000-000000000002", conversationId: "conversation-id", snippet: "outro produto", matchedText: "produto", direction: "OUTBOUND", type: "TEXT", externalTimestamp: "2026-08-22T12:01:00Z", contact: { id: "contact", name: "Ana", phone: "1" } },
  ],
  loading: false,
  loadingMore: false,
  error: null,
  nextCursor: null,
  retry: vi.fn(),
  loadMore: vi.fn(),
  activeIndex: 0,
  setActiveIndex: vi.fn(),
  next: vi.fn(),
  previous: vi.fn(),
  reset: vi.fn(),
}));

vi.mock("@/hooks/use-message-search", () => ({ useMessageSearch: vi.fn(() => search) }));

describe("ConversationMessageSearch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("opens, searches, navigates by keyboard, and restores focus on Escape", async () => {
    const user = userEvent.setup();
    const onTarget = vi.fn();
    render(<ConversationMessageSearch conversationId="conversation-id" onTarget={onTarget} />);
    const trigger = screen.getByRole("button", { name: "Pesquisar nesta conversa" });

    await user.click(trigger);
    const input = screen.getByRole("searchbox", { name: "Pesquisar nesta conversa" });
    expect(input).toHaveFocus();
    expect(screen.getByText("1 de 2")).toBeInTheDocument();

    await user.keyboard("{Enter}");
    expect(search.setActiveIndex).toHaveBeenCalledWith(1);
    expect(onTarget).toHaveBeenCalledWith(search.items[1]);

    await user.keyboard("{Shift>}{Enter}{/Shift}");
    expect(search.setActiveIndex).toHaveBeenCalledWith(1);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("searchbox", { name: "Pesquisar nesta conversa" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("offers touch buttons for previous and next matches", async () => {
    const user = userEvent.setup();
    const onTarget = vi.fn();
    render(<ConversationMessageSearch conversationId="conversation-id" onTarget={onTarget} />);
    await user.click(screen.getByRole("button", { name: "Pesquisar nesta conversa" }));
    await user.click(screen.getByRole("button", { name: "Ocorrência anterior" }));
    expect(onTarget).toHaveBeenCalledWith(search.items[1]);
    await user.click(screen.getByRole("button", { name: "Próxima ocorrência" }));
    expect(onTarget).toHaveBeenCalledWith(search.items[1]);
  });
});
