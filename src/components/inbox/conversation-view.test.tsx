import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { InboxConversation, InboxMessage } from "@/hooks/use-inbox";

import { ConversationView } from "./conversation-view";

const message: InboxMessage = {
  id: "message-1",
  direction: "INBOUND",
  type: "TEXT",
  body: "Olá",
  mediaObjectId: null,
  sentBy: null,
  status: "RECEIVED",
  failureReason: null,
  externalTimestamp: "2026-08-20T14:30:00.000Z",
  createdAt: "2026-08-20T14:30:00.000Z",
};

const conversation: InboxConversation = {
  id: "conversation-id",
  contact: { id: "contact-id", name: "Carlos", phone: "5561999999999", profilePictureUrl: null },
  responsible: null,
  lastMessageAt: message.externalTimestamp,
  latestMessage: message,
  unreadCount: 0,
  createdAt: message.createdAt,
  updatedAt: message.createdAt,
  messages: [message],
  lastReadMessageId: null,
  lastReadAt: null,
};

const handlers = {
  error: null,
  loading: false,
  onBack: vi.fn(),
  onOpenDetails: vi.fn(),
  onRetryLoad: vi.fn(),
  onVisibleMessage: vi.fn(),
  onSendText: vi.fn().mockResolvedValue(null),
  onSendMedia: vi.fn().mockResolvedValue(null),
  onRetryMessage: vi.fn(),
};

describe("ConversationView", () => {
  beforeEach(() => vi.clearAllMocks());

  it("scrolls new conversations to the end without pulling a reader away from older messages", () => {
    const { rerender, getByRole } = render(<ConversationView {...handlers} conversation={null} />);
    rerender(<ConversationView {...handlers} conversation={conversation} />);
    const history = getByRole("log");
    const scrollTo = vi.fn();
    Object.defineProperties(history, {
      scrollHeight: { configurable: true, value: 1_000 },
      clientHeight: { configurable: true, value: 100 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    });
    Object.defineProperty(history, "scrollTo", { configurable: true, value: scrollTo });

    expect(handlers.onVisibleMessage).toHaveBeenCalledWith("message-1");
    handlers.onVisibleMessage.mockClear();

    fireEvent.scroll(history);
    rerender(<ConversationView {...handlers} conversation={{ ...conversation, messages: [...conversation.messages, { ...message, id: "message-2" }] }} />);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(handlers.onVisibleMessage).not.toHaveBeenCalledWith("message-2");

    history.scrollTop = 900;
    fireEvent.scroll(history);
    rerender(<ConversationView {...handlers} conversation={{ ...conversation, messages: [...conversation.messages, { ...message, id: "message-2" }, { ...message, id: "message-3" }] }} />);
    expect(scrollTo).toHaveBeenCalledWith({ top: 1_000, behavior: "smooth" });
    expect(handlers.onVisibleMessage).toHaveBeenCalledWith("message-3");
  });

  it.each([
    { loading: true, error: null },
    { loading: false, error: "Falha ao carregar" },
  ])("keeps mobile back navigation available while the thread is unavailable", ({ loading, error }) => {
    render(<ConversationView {...handlers} conversation={null} error={error} loading={loading} />);

    fireEvent.click(screen.getByRole("button", { name: "Voltar para conversas" }));
    expect(handlers.onBack).toHaveBeenCalledOnce();
  });
});
