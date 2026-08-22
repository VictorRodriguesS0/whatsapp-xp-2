import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { InboxConversation, InboxMessage } from "@/hooks/use-inbox";

import { ConversationView } from "./conversation-view";

const audioRecorder = vi.hoisted(() => ({
  phase: "idle",
  supported: true,
  durationMs: 0,
  recording: null as null | {
    clientRequestId: string;
    durationMs: number;
    file: File;
    previewUrl: string;
  },
  error: null,
  start: vi.fn(),
  stop: vi.fn(),
  cancel: vi.fn(),
  discard: vi.fn(),
}));
const useAudioRecorderMock = vi.hoisted(() => vi.fn(() => audioRecorder));
vi.mock("@/hooks/use-audio-recorder", () => ({ useAudioRecorder: useAudioRecorderMock }));

const message: InboxMessage = {
  id: "message-1",
  direction: "INBOUND",
  type: "TEXT",
  body: "Olá",
  mediaObjectId: null,
  mediaState: null,
  sentBy: null,
  status: "RECEIVED",
  failureReason: null,
  externalTimestamp: "2026-08-20T14:30:00.000Z",
  createdAt: "2026-08-20T14:30:00.000Z",
};

const conversation: InboxConversation = {
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
  lastMessageAt: message.externalTimestamp,
  latestMessage: message,
  unreadCount: 0,
  manuallyUnread: false,
  manualUnreadRevision: null,
  awaitingResponseSince: message.externalTimestamp,
  revision: message.createdAt,
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
  onSendRecording: vi.fn().mockResolvedValue(null),
  onRetryMessage: vi.fn(),
};

describe("ConversationView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    audioRecorder.phase = "idle";
    audioRecorder.recording = null;
  });

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

  it("resets scroll and visibility tracking after closing and reopening the same conversation", () => {
    const scrollTo = vi.fn();
    const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: scrollTo });
    const { rerender } = render(<ConversationView {...handlers} conversation={conversation} />);
    scrollTo.mockClear();
    handlers.onVisibleMessage.mockClear();

    rerender(<ConversationView {...handlers} conversation={null} />);
    rerender(<ConversationView {...handlers} conversation={conversation} />);

    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: "auto" }));
    expect(handlers.onVisibleMessage).toHaveBeenCalledWith("message-1");
    if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, "scrollTo", originalScrollTo);
    else delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo;
  });

  it("uses instant scrolling when reduced motion is requested", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    const { rerender, getByRole } = render(<ConversationView {...handlers} conversation={conversation} />);
    const history = getByRole("log");
    const scrollTo = vi.fn();
    Object.defineProperties(history, {
      scrollHeight: { configurable: true, value: 1_000 },
      clientHeight: { configurable: true, value: 100 },
      scrollTop: { configurable: true, writable: true, value: 900 },
      scrollTo: { configurable: true, value: scrollTo },
    });
    fireEvent.scroll(history);

    rerender(<ConversationView {...handlers} conversation={{ ...conversation, messages: [...conversation.messages, { ...message, id: "message-2" }] }} />);

    expect(scrollTo).toHaveBeenCalledWith({ top: 1_000, behavior: "auto" });
    vi.unstubAllGlobals();
  });

  it("scopes the recorder to the active conversation and propagates recorded sends", async () => {
    const file = new File(["voice"], "gravacao.webm", { type: "audio/webm" });
    audioRecorder.phase = "preview";
    audioRecorder.durationMs = 2_000;
    audioRecorder.recording = {
      clientRequestId: "11111111-1111-4111-8111-111111111111",
      durationMs: 2_000,
      file,
      previewUrl: "blob:recording",
    };
    handlers.onSendRecording.mockResolvedValueOnce({ id: "sent" });

    render(<ConversationView {...handlers} conversation={conversation} />);
    fireEvent.click(screen.getByRole("button", { name: "Enviar gravação" }));

    expect(useAudioRecorderMock).toHaveBeenLastCalledWith({ scopeKey: "conversation-id" });
    expect(handlers.onSendRecording).toHaveBeenCalledWith(file, audioRecorder.recording.clientRequestId);
  });

  it("offers the 44px manual unread action and restores focus after it settles", async () => {
    const onMarkUnread = vi.fn().mockResolvedValue(undefined);
    const unreadProps = { markUnreadError: null, markUnreadPending: false, onMarkUnread };
    render(<ConversationView {...handlers} {...unreadProps} conversation={conversation} />);

    const action = screen.getByRole("button", { name: "Marcar como não lida" });
    expect(action).toHaveClass("min-h-11");
    fireEvent.click(action);

    await waitFor(() => expect(onMarkUnread).toHaveBeenCalledWith(conversation.id));
    expect(action).toHaveFocus();
  });

  it("does not steal focus when a pending action for A settles after the header switches to B", async () => {
    let settle!: () => void;
    const pending = new Promise<void>((resolve) => { settle = resolve; });
    const onMarkUnread = vi.fn(() => pending);
    const conversationB: InboxConversation = {
      ...conversation,
      id: "conversation-b",
      contact: { ...conversation.contact, id: "contact-b", name: "Beatriz" },
    };
    const unreadProps = { markUnreadError: null, markUnreadPending: false, onMarkUnread };
    const { rerender } = render(<ConversationView {...handlers} {...unreadProps} conversation={conversation} />);
    const action = screen.getByRole("button", { name: "Marcar como não lida" });
    fireEvent.click(action);

    rerender(<ConversationView {...handlers} {...unreadProps} conversation={conversationB} />);
    const otherControl = document.createElement("button");
    document.body.append(otherControl);
    otherControl.focus();
    await act(async () => { settle(); await pending; });

    expect(onMarkUnread).toHaveBeenCalledWith("conversation-id");
    expect(otherControl).toHaveFocus();
    otherControl.remove();
  });

  it("keeps the manual unread action unavailable while saving and exposes a safe error", () => {
    const unreadProps = {
      markUnreadError: "Não foi possível marcar como não lida.",
      markUnreadPending: true,
      onMarkUnread: vi.fn().mockResolvedValue(undefined),
    };
    render(<ConversationView {...handlers} {...unreadProps} conversation={conversation} />);

    const action = screen.getByRole("button", { name: "Marcar como não lida" });
    expect(action).toBeDisabled();
    expect(action).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível marcar como não lida.");
  });

  it("replaces a pending audio status with the player after reconciliation", () => {
    const pendingAudio: InboxMessage = {
      ...message,
      id: "40000000-0000-4000-8000-000000000002",
      type: "AUDIO",
      body: null,
      mediaObjectId: "50000000-0000-4000-8000-000000000001",
      mediaState: { status: "PENDING", nextAttemptAt: "2099-08-21T15:00:00.000Z", canRetry: false },
    };
    const pendingConversation = { ...conversation, messages: [pendingAudio] };
    const view = render(<ConversationView {...handlers} conversation={pendingConversation} />);

    expect(screen.getByRole("status")).toHaveTextContent("Baixando áudio");
    expect(view.container.querySelector("audio")).toBeNull();

    view.rerender(
      <ConversationView
        {...handlers}
        conversation={{
          ...pendingConversation,
          messages: [{
            ...pendingAudio,
            mediaState: { status: "AVAILABLE", nextAttemptAt: null, canRetry: false },
          }],
        }}
      />,
    );
    expect(view.container.querySelector("audio")).toHaveAttribute(
      "src",
      `/api/media/${pendingAudio.mediaObjectId}`,
    );
  });
});
