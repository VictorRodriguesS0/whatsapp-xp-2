import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionUser } from "@/modules/auth/session";

import { InboxShell } from "./inbox-shell";

const useInboxMock = vi.hoisted(() => vi.fn());
const routerReplaceMock = vi.hoisted(() => vi.fn());
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

vi.mock("@/hooks/use-inbox", () => ({ useInbox: useInboxMock }));
vi.mock("@/hooks/use-audio-recorder", () => ({ useAudioRecorder: vi.fn(() => audioRecorder) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: routerReplaceMock }) }));

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
  sendRecording: vi.fn(),
  retryMessage: vi.fn(),
  markRead: vi.fn(),
  markUnread: vi.fn().mockResolvedValue(undefined),
  markUnreadPending: false,
  markUnreadError: null,
  setResponsible: vi.fn(),
};

const user: SessionUser = { id: "user-id", name: "Marcos", email: "marcos@xp.test", role: "ATTENDANT" };

describe("InboxShell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    audioRecorder.phase = "idle";
    audioRecorder.recording = null;
    useInboxMock.mockReturnValue(defaultInbox);
    routerReplaceMock.mockReset();
  });

  it("shows both admin settings actions only to administrators", () => {
    const { rerender } = render(<InboxShell initialUser={user} />);
    expect(screen.queryByRole("link", { name: "Configurar classificações" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Configurar usuários" })).not.toBeInTheDocument();

    rerender(<InboxShell initialUser={{ ...user, role: "ADMIN" }} />);
    expect(screen.getByRole("link", { name: "Configurar classificações" })).toHaveAttribute("href", "/configuracoes/atendimento");
    expect(screen.getByRole("link", { name: "Configurar usuários" })).toHaveAttribute("href", "/configuracoes/usuarios");
  });

  it("uses the app router for logout and handles rejected logout and navigation promises", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    routerReplaceMock.mockRejectedValue(new Error("navigation cancelled"));
    render(<InboxShell initialUser={user} />);

    fireEvent.click(screen.getByRole("button", { name: "Sair" }));

    await waitFor(() => expect(routerReplaceMock).toHaveBeenCalledWith("/login"));
  });

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

  it("restores focus to the mobile details trigger when the dialog closes", async () => {
    const userEventController = userEvent.setup();
    useInboxMock.mockReturnValue({
      ...defaultInbox,
      selectedId: "conversation-id",
      conversation: {
        ...defaultInbox.conversations[0],
        createdAt: "2026-08-20T14:30:00.000Z",
        updatedAt: "2026-08-20T14:31:00.000Z",
        messages: [],
        lastReadMessageId: null,
        lastReadAt: null,
      },
    });
    render(<InboxShell initialUser={user} />);
    const trigger = screen.getByRole("button", { name: "Abrir dados do cliente" });

    await userEventController.click(trigger);
    expect(screen.getByRole("dialog", { name: "Dados do cliente" })).toBeVisible();
    await userEventController.keyboard("{Escape}");

    await waitFor(() => expect(trigger).toHaveFocus());
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

  it("routes a voice preview through the selected conversation", async () => {
    const file = new File(["voice"], "gravacao.webm", { type: "audio/webm" });
    audioRecorder.phase = "preview";
    audioRecorder.durationMs = 2_000;
    audioRecorder.recording = {
      clientRequestId: "11111111-1111-4111-8111-111111111111",
      durationMs: 2_000,
      file,
      previewUrl: "blob:recording",
    };
    defaultInbox.sendRecording.mockResolvedValueOnce({ id: "sent" });
    useInboxMock.mockReturnValue({
      ...defaultInbox,
      selectedId: "conversation-id",
      conversation: {
        ...defaultInbox.conversations[0],
        createdAt: "2026-08-20T14:30:00.000Z",
        updatedAt: "2026-08-20T14:31:00.000Z",
        messages: [],
        lastReadMessageId: null,
        lastReadAt: null,
      },
    });

    render(<InboxShell initialUser={user} />);
    fireEvent.click(screen.getByRole("button", { name: "Enviar gravação" }));

    await waitFor(() => expect(defaultInbox.sendRecording).toHaveBeenCalledWith(
      "conversation-id",
      file,
      audioRecorder.recording?.clientRequestId,
    ));
  });

  it("routes the header manual unread action through the selected conversation", () => {
    useInboxMock.mockReturnValue({
      ...defaultInbox,
      selectedId: "conversation-id",
      conversation: {
        ...defaultInbox.conversations[0],
        createdAt: "2026-08-20T14:30:00.000Z",
        updatedAt: "2026-08-20T14:31:00.000Z",
        messages: [],
        lastReadMessageId: null,
        lastReadAt: null,
      },
    });
    render(<InboxShell initialUser={user} />);

    fireEvent.click(screen.getByRole("button", { name: "Marcar como não lida" }));
    expect(defaultInbox.markUnread).toHaveBeenCalledWith("conversation-id");
  });
});
