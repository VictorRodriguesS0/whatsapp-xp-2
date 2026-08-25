import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { InboxConversation } from "@/hooks/use-inbox";

import { ThreadHeader } from "./thread-header";

const conversation = {
  id: "conversation-id",
  contact: { id: "contact-id", name: "Um nome de contato excepcionalmente longo que continua sem quebrar o cabeçalho", phone: "5561999999999" },
} as InboxConversation;

describe("ThreadHeader", () => {
  it("keeps a long contact identity shrinkable and all direct controls at 44px", () => {
    render(<ThreadHeader conversation={conversation} onBack={vi.fn()} onOpenDetails={vi.fn()} onSearchTarget={vi.fn()} />);

    expect(screen.getByTestId("thread-heading-container")).toHaveClass("min-w-0");
    for (const name of ["Voltar para conversas", "Pesquisar nesta conversa", "Mais opções"]) {
      expect(screen.getByRole("button", { name })).toHaveClass("min-h-11");
    }
  });

  it("gives the opened conversation search a full second header row", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ThreadHeader conversation={conversation} onBack={vi.fn()} onOpenDetails={vi.fn()} onSearchTarget={vi.fn()} />,
    );

    await user.click(screen.getByRole("button", { name: "Pesquisar nesta conversa" }));

    expect(container.querySelector("header")).toHaveClass("flex-wrap");
    expect(screen.getByRole("searchbox", { name: "Pesquisar nesta conversa" }).parentElement).toHaveClass(
      "order-last",
      "basis-full",
    );
  });

  it("does not expose in-thread search without a target handler", () => {
    render(<ThreadHeader conversation={conversation} onBack={vi.fn()} onOpenDetails={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "Pesquisar nesta conversa" })).not.toBeInTheDocument();
  });

  it("moves mobile secondary actions into Mais opções while retaining desktop names", async () => {
    const onOpenDetails = vi.fn();
    const onMarkUnread = vi.fn().mockResolvedValue(undefined);
    render(
      <ThreadHeader
        conversation={conversation}
        onBack={vi.fn()}
        onMarkUnread={onMarkUnread}
        onOpenDetails={onOpenDetails}
      />,
    );

    expect(screen.getByRole("button", { name: "Marcar como não lida" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Abrir dados do cliente" })).toBeVisible();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Mais opções" }));
    await user.click(await screen.findByRole("menuitem", { name: "Marcar como não lida" }));
    await waitFor(() => expect(onMarkUnread).toHaveBeenCalledWith(conversation.id));
    await user.click(screen.getByRole("button", { name: "Mais opções" }));
    await user.click(await screen.findByRole("menuitem", { name: "Abrir dados do cliente" }));
    expect(onOpenDetails).toHaveBeenCalledOnce();
  });

  it("restores focus to Mais opções after its menu closes", async () => {
    const user = userEvent.setup();
    render(<ThreadHeader conversation={conversation} onBack={vi.fn()} onOpenDetails={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "Mais opções" });
    await user.click(trigger);
    await user.click(await screen.findByRole("menuitem", { name: "Abrir dados do cliente" }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("announces pending and failed manual-unread state", () => {
    render(
      <ThreadHeader
        conversation={conversation}
        markUnreadError="Não foi possível marcar como não lida."
        markUnreadPending
        onBack={vi.fn()}
        onMarkUnread={vi.fn()}
        onOpenDetails={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Marcar como não lida" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível marcar como não lida.");
  });
});
