import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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

const availableType = {
  id: "type-id",
  displayName: "Cliente",
  color: "#176B52",
  position: 10,
  active: true,
};

const defaultInbox = {
  conversations: [{
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
      unreadCount: 1,
      manuallyUnread: false,
      manualUnreadRevision: null,
      awaitingResponseSince: null,
      revision: "2026-08-20T14:30:00.000Z",
  }],
  conversation: null,
  users: [],
  contactTypes: [availableType],
  contactTags: [],
  selectedId: null,
  search: "",
  loadingList: false,
  loadingConversation: false,
  loadingMore: false,
  loadMoreError: null,
  nextCursor: null,
  responsiblePending: false,
  contactTypesLoading: false,
  contactTypesError: null,
  contactTypeSavePendingId: null,
  contactTypeSaveError: null,
  contactTagsLoading: false,
  contactTagsError: null,
  contactTagSavePendingId: null,
  contactTagSaveError: null,
  listError: null,
  conversationError: null,
  connected: true,
  setSearch: vi.fn(),
  openConversation: vi.fn(),
  closeConversation: vi.fn(),
  refreshList: vi.fn(),
  refreshConversation: vi.fn(),
  loadContactTypes: vi.fn(),
  loadContactTags: vi.fn(),
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
  setContactType: vi.fn().mockResolvedValue(true),
  replaceContactTags: vi.fn().mockResolvedValue(true),
};

const user: SessionUser = { id: "user-id", name: "Marcos", email: "marcos@xp.test", role: "ATTENDANT" };

describe("InboxShell", () => {
  beforeAll(() => {
    Object.defineProperties(HTMLElement.prototype, {
      hasPointerCapture: { configurable: true, value: () => false },
      releasePointerCapture: { configurable: true, value: () => undefined },
      scrollIntoView: { configurable: true, value: () => undefined },
      setPointerCapture: { configurable: true, value: () => undefined },
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, "", window.location.href);
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
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
    render(<InboxShell initialUser={user} />);
    const conversationButton = screen.getByRole("button", { name: /Carlos/i });
    fireEvent.click(conversationButton);
    expect(screen.getByTestId("inbox-shell")).toHaveAttribute("data-mobile-view", "thread");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Conversa" })).toHaveFocus());

    fireEvent.click(screen.getByRole("button", { name: "Voltar para conversas" }));
    expect(back).toHaveBeenCalledOnce();
    window.history.replaceState(null, "", window.location.href);
    fireEvent(window, new PopStateEvent("popstate", { state: null }));
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
    expect(defaultInbox.closeConversation).not.toHaveBeenCalled();
  });

  it("lets the label editor consume Escape before the desktop conversation", async () => {
    const userEventController = userEvent.setup();
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
    useInboxMock.mockReturnValue({
      ...defaultInbox,
      selectedId: "conversation-id",
      contactTags: [{
        id: "tag-id",
        displayName: "Prioridade",
        color: "#B4443C",
        position: 10,
        active: true,
      }],
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

    await userEventController.click(screen.getByRole("button", { name: "Gerenciar etiquetas" }));
    expect(screen.getByRole("dialog", { name: "Gerenciar etiquetas" })).toBeVisible();
    await userEventController.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Gerenciar etiquetas" })).not.toBeInTheDocument());
    expect(defaultInbox.closeConversation).not.toHaveBeenCalled();
  });

  it("closes the desktop conversation with Escape and restores its exact list button", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
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
    const row = screen.getByRole("button", { name: /Carlos/i });

    fireEvent.keyDown(window, { key: "Escape" });

    expect(defaultInbox.closeConversation).toHaveBeenCalledOnce();
    await waitFor(() => expect(row).toHaveFocus());
  });

  it("ignores Escape without a selection and ignores repeated, composing or prevented events", () => {
    const { rerender } = render(<InboxShell initialUser={user} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(defaultInbox.closeConversation).not.toHaveBeenCalled();

    useInboxMock.mockReturnValue({ ...defaultInbox, selectedId: "conversation-id" });
    rerender(<InboxShell initialUser={user} />);
    fireEvent.keyDown(window, { key: "Escape", repeat: true });
    fireEvent.keyDown(window, { key: "Escape", isComposing: true });
    const prevented = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    prevented.preventDefault();
    window.dispatchEvent(prevented);
    expect(defaultInbox.closeConversation).not.toHaveBeenCalled();
  });

  it("uses two mobile history layers so browser back closes details before the thread", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockImplementation((query: string) => ({ matches: query === "(max-width: 719px)" })));
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
    fireEvent.click(screen.getByRole("button", { name: /Carlos/i }));
    expect(window.history.state).toEqual({ __xpInboxLayer: "thread" });

    fireEvent.click(screen.getByRole("button", { name: "Abrir dados do cliente" }));
    expect(await screen.findByRole("dialog", { name: "Dados do cliente" })).toBeVisible();
    expect(window.history.state).toEqual({ __xpInboxLayer: "details" });

    window.history.replaceState({ __xpInboxLayer: "thread" }, "", window.location.href);
    fireEvent(window, new PopStateEvent("popstate", { state: { __xpInboxLayer: "thread" } }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Dados do cliente" })).not.toBeInTheDocument());
    expect(defaultInbox.closeConversation).not.toHaveBeenCalled();

    window.history.replaceState(null, "", window.location.href);
    fireEvent(window, new PopStateEvent("popstate", { state: null }));
    expect(defaultInbox.closeConversation).toHaveBeenCalledOnce();
    expect(screen.getByTestId("inbox-shell")).toHaveAttribute("data-mobile-view", "list");
  });

  it("does not stack mobile history when switching conversations and leaves list-level back alone", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockImplementation((query: string) => ({ matches: query === "(max-width: 719px)" })));
    const pushState = vi.spyOn(window.history, "pushState");
    const replaceState = vi.spyOn(window.history, "replaceState");
    useInboxMock.mockReturnValue({
      ...defaultInbox,
      conversations: [
        ...defaultInbox.conversations,
        {
          ...defaultInbox.conversations[0],
          id: "conversation-two",
          contact: { ...defaultInbox.conversations[0].contact, id: "contact-two", name: "Beatriz", profileName: "Beatriz" },
        },
      ],
    });
    render(<InboxShell initialUser={user} />);

    fireEvent(window, new PopStateEvent("popstate", { state: null }));
    expect(defaultInbox.closeConversation).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Carlos/i }));
    fireEvent.click(screen.getByRole("button", { name: /Beatriz/i }));

    expect(pushState).toHaveBeenCalledOnce();
    expect(replaceState).toHaveBeenCalledWith(
      { __xpInboxLayer: "thread" },
      "",
      window.location.href,
    );
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

  it("wires contact type changes in desktop and mobile customer panels", async () => {
    const userEventController = userEvent.setup();
    vi.stubGlobal("matchMedia", vi.fn().mockImplementation((query: string) => ({
      matches: query === "(max-width: 719px)",
    })));
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

    const desktopPanel = screen.getByRole("complementary", { name: "Dados do cliente" });
    await userEventController.click(
      within(desktopPanel).getByRole("combobox", { name: "Tipo de contato" }),
    );
    await userEventController.click(screen.getByRole("option", { name: "Cliente" }));
    expect(defaultInbox.setContactType).toHaveBeenCalledWith("contact-id", "type-id");

    await userEventController.click(screen.getByRole("button", { name: "Abrir dados do cliente" }));
    const dialog = await screen.findByRole("dialog", { name: "Dados do cliente" });
    await userEventController.click(
      within(dialog).getByRole("combobox", { name: "Tipo de contato" }),
    );
    await userEventController.click(screen.getByRole("option", { name: "Cliente" }));
    expect(defaultInbox.setContactType).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
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
