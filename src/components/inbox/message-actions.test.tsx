import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InboxMessage } from "@/hooks/use-inbox";

import { MessageActions } from "./message-actions";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const message = {
  id: "20000000-0000-4000-8000-000000000001",
  direction: "INBOUND",
  type: "TEXT",
  body: "Olá",
  content: null,
  canReply: true,
  replyTo: null,
  mediaObjectId: null,
  mediaState: null,
  sentBy: null,
  revokedAt: null,
  failureReason: null,
  status: "RECEIVED",
  reactions: [],
  externalTimestamp: "2026-08-24T12:00:00.000Z",
  createdAt: "2026-08-24T12:00:00.000Z",
} as InboxMessage;

describe("MessageActions", () => {
  let initialHistoryState: unknown;
  let initialHistoryUrl: string;

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    initialHistoryState = window.history.state;
    initialHistoryUrl = window.location.href;
    window.history.replaceState({ test: "message-actions-base" }, "", window.location.href);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState(initialHistoryState, "", initialHistoryUrl);
  });

  it("exposes the desktop toolbar on keyboard focus", async () => {
    const user = userEvent.setup();
    render(<MessageActions message={message} onReact={vi.fn()} onReply={vi.fn()} />);

    await user.tab();
    expect(screen.getByTestId("desktop-message-actions")).toHaveClass("group-focus-within/message:opacity-100");
    expect(screen.getByRole("button", { name: "Responder à mensagem" })).toBeVisible();
  });

  it("offers one explicit mobile menu with reply and quick reactions, then restores focus", async () => {
    const onReply = vi.fn();
    const onReact = vi.fn();
    render(<MessageActions message={message} onReact={onReact} onReply={onReply} />);
    const trigger = screen.getByRole("button", { name: "Ações da mensagem" });
    expect(trigger).toHaveClass("min-h-11");
    const user = userEvent.setup();
    await user.click(trigger);
    await user.click(await screen.findByRole("menuitem", { name: "Responder" }));
    expect(onReply).toHaveBeenCalledWith(message);
    await waitFor(() => expect(trigger).toHaveFocus());

    await user.click(trigger);
    await user.click(await screen.findByRole("menuitem", { name: "Reagir" }));
    await user.click(screen.getByRole("button", { name: "Reagir com 😂" }));
    expect(onReact).toHaveBeenCalledWith(message.id, "😂");
    expect(trigger).toHaveFocus();
  });

  it("does not expose controls when content cannot be replied to or reacted to", () => {
    render(<MessageActions message={{ ...message, canReply: false, status: "FAILED" }} onReact={vi.fn()} onReply={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Ações da mensagem" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Responder à mensagem" })).not.toBeInTheDocument();
  });

  it("does not expose reaction-only controls for expired content", () => {
    render(
      <MessageActions
        message={{ ...message, canReply: true, externalTimestamp: "2020-01-01T00:00:00.000Z" }}
        onReact={vi.fn()}
        onReply={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Ações da mensagem" })).not.toBeInTheDocument();
  });

  it("keeps a full emoji picker available from the mobile reaction menu", async () => {
    const user = userEvent.setup();
    render(<MessageActions message={message} onReact={vi.fn()} onReply={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Ações da mensagem" }));
    await user.click(await screen.findByRole("menuitem", { name: "Reagir" }));
    await user.click(screen.getByRole("button", { name: "Escolher outro emoji" }));
    expect(await screen.findByRole("searchbox", { name: "Buscar emoji" })).toBeVisible();
  });

  it("uses a browser history entry for the mobile menu and consumes it on browser back", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    const user = userEvent.setup();
    render(<MessageActions message={message} onReact={vi.fn()} onReply={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "Ações da mensagem" });
    await user.click(trigger);
    expect(window.history.state).toMatchObject({ __xpMessageActions: message.id });

    window.history.back();
    await waitFor(() => expect(window.history.state).toEqual({ test: "message-actions-base" }));
    await waitFor(() => expect(screen.queryByRole("menuitem", { name: "Responder" })).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("consumes its own history layer when unmounted with the mobile menu open", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    const user = userEvent.setup();
    const { unmount } = render(<MessageActions message={message} onReact={vi.fn()} onReply={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Ações da mensagem" }));
    expect(window.history.state).toMatchObject({ __xpMessageActions: message.id });
    unmount();

    await waitFor(() => expect(window.history.state).toEqual({ test: "message-actions-base" }));
  });

  it("does not consume a newer foreign history layer when unmounted", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    const user = userEvent.setup();
    const { unmount } = render(<MessageActions message={message} onReact={vi.fn()} onReply={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Ações da mensagem" }));
    const foreignState = { ...window.history.state, __xpForeignOverlay: "details" };
    window.history.pushState(foreignState, "", window.location.href);
    unmount();

    await Promise.resolve();
    expect(window.history.state).toEqual(foreignState);
  });
});
