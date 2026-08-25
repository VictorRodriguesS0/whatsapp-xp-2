import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { ConversationListItem } from "@/modules/conversations/types";

import { CustomerPanel } from "./customer-panel";

const conversation: ConversationListItem = {
  id: "conversation-id",
  contact: {
    id: "contact-id",
    profileName: "Carlos",
    preferredName: null,
    name: "Carlos",
    phone: "5561999999999",
    messagingRestricted: false,
    messagingConsent: {
      active: false,
      source: null,
      grantedAt: null,
      grantedBy: null,
      note: null,
    },
    type: null,
    tags: [],
  },
  responsible: null,
  pinnedAt: null,
  lastMessageAt: "2026-08-20T14:30:00.000Z",
  latestMessage: null,
  unreadCount: 0,
  manuallyUnread: false,
  manualUnreadRevision: null,
  revision: "2026-08-20T14:30:00.000Z",
  serviceWindow: {
    enforcement: "INACTIVE",
    status: "CLOSED",
    closesAt: null,
    sendMode: "FREE_FORM",
    reason: null,
    resumption: null,
  },
};

const availableTag = {
  id: "40000000-0000-4000-8000-000000000001",
  displayName: "Aguardando produto",
  color: "#176B52",
  position: 10,
  active: true,
};

const availableType = {
  id: "50000000-0000-4000-8000-000000000001",
  displayName: "Cliente",
  color: "#2458A6",
  position: 10,
  active: true,
};

const tagProps = {
  availableTypes: [availableType],
  typesLoading: false,
  typesError: null,
  typeSavePending: false,
  typeSaveError: null,
  onRetryTypes: vi.fn(),
  onSetContactType: vi.fn().mockResolvedValue(true),
  availableTags: [availableTag],
  tagsLoading: false,
  tagsError: null,
  tagSavePending: false,
  tagSaveError: null,
  onRetryTags: vi.fn(),
  onSaveTags: vi.fn().mockResolvedValue(true),
};

beforeAll(() => {
  Object.defineProperties(HTMLElement.prototype, {
    hasPointerCapture: { configurable: true, value: () => false },
    releasePointerCapture: { configurable: true, value: () => undefined },
    scrollIntoView: { configurable: true, value: () => undefined },
    setPointerCapture: { configurable: true, value: () => undefined },
  });
});

describe("CustomerPanel", () => {
  it("requires an explicit reason before marking a contact as do not contact", async () => {
    const user = userEvent.setup();
    const onSetMessagingRestriction = vi.fn().mockResolvedValue(true);
    render(
      <CustomerPanel
        {...tagProps}
        conversation={conversation}
        currentUserId="user-id"
        onSetMessagingRestriction={onSetMessagingRestriction}
        onSetResponsible={vi.fn()}
        users={[]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Não contatar" }));
    const dialog = screen.getByRole("alertdialog", { name: "Marcar como não contatar?" });
    expect(screen.getByRole("button", { name: "Confirmar restrição" })).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "Motivo" }), "Cliente solicitou");
    await user.click(screen.getByRole("button", { name: "Confirmar restrição" }));

    expect(onSetMessagingRestriction).toHaveBeenCalledWith(
      conversation.contact.id,
      true,
      "Cliente solicitou",
    );
    expect(dialog).not.toBeInTheDocument();
  });

  it("keeps the restriction visible and requires a reason to allow contact again", async () => {
    const user = userEvent.setup();
    const onSetMessagingRestriction = vi.fn().mockResolvedValue(true);
    render(
      <CustomerPanel
        {...tagProps}
        conversation={{
          ...conversation,
          contact: { ...conversation.contact, messagingRestricted: true },
        }}
        currentUserId="user-id"
        onSetMessagingRestriction={onSetMessagingRestriction}
        onSetResponsible={vi.fn()}
        users={[]}
      />,
    );

    expect(screen.getByText("Este contato está marcado como não contatar.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Permitir contato novamente" }));
    await user.type(screen.getByRole("textbox", { name: "Motivo" }), "Cliente autorizou");
    await user.click(screen.getByRole("button", { name: "Confirmar permissão" }));
    expect(onSetMessagingRestriction).toHaveBeenCalledWith(
      conversation.contact.id,
      false,
      "Cliente autorizou",
    );
  });

  it("keeps the confirmation reason available when saving the restriction fails", async () => {
    const user = userEvent.setup();
    const onSetMessagingRestriction = vi.fn().mockResolvedValue(false);
    render(
      <CustomerPanel
        {...tagProps}
        conversation={conversation}
        currentUserId="user-id"
        messagingRestrictionError="Não foi possível salvar a preferência de contato."
        onSetMessagingRestriction={onSetMessagingRestriction}
        onSetResponsible={vi.fn()}
        users={[]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Não contatar" }));
    await user.type(screen.getByRole("textbox", { name: "Motivo" }), "Cliente solicitou");
    await user.click(screen.getByRole("button", { name: "Confirmar restrição" }));

    const dialog = screen.getByRole("alertdialog", { name: "Marcar como não contatar?" });
    expect(dialog).toBeVisible();
    expect(within(dialog).getByRole("textbox", { name: "Motivo" })).toHaveValue("Cliente solicitou");
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Não foi possível salvar a preferência de contato.",
    );
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(1);
  });

  it("shows and changes the contact type above labels", async () => {
    const user = userEvent.setup();
    const onSetContactType = vi.fn().mockResolvedValue(true);
    render(
      <CustomerPanel
        {...tagProps}
        conversation={conversation}
        currentUserId="user-id"
        onSetContactType={onSetContactType}
        onSetResponsible={vi.fn()}
        users={[]}
      />,
    );

    expect(screen.getByRole("heading", { name: "Tipo de contato" })).toBeVisible();
    expect(screen.getAllByText("Sem tipo").length).toBeGreaterThan(0);
    const typeHeading = screen.getByRole("heading", { name: "Tipo de contato" });
    const tagsHeading = screen.getByRole("heading", { name: "Etiquetas" });
    expect(
      typeHeading.compareDocumentPosition(tagsHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await user.click(screen.getByRole("combobox", { name: "Tipo de contato" }));
    await user.click(screen.getByRole("option", { name: "Cliente" }));
    expect(onSetContactType).toHaveBeenCalledWith(
      conversation.contact.id,
      availableType.id,
    );
  });

  it("blocks assignment controls while an update is pending", () => {
    render(
      <CustomerPanel
        {...tagProps}
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

  it("shows textual assigned labels and wires the multi-label editor", async () => {
    const user = userEvent.setup();
    const onSaveTags = vi.fn().mockResolvedValue(true);
    render(
      <CustomerPanel
        {...tagProps}
        conversation={{
          ...conversation,
          contact: {
            ...conversation.contact,
            tags: [{ id: availableTag.id, name: availableTag.displayName, color: availableTag.color, active: true }],
          },
        }}
        currentUserId="user-id"
        onSaveTags={onSaveTags}
        onSetResponsible={vi.fn()}
        users={[]}
      />,
    );

    expect(screen.getByText(availableTag.displayName)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Gerenciar etiquetas" }));
    await user.click(screen.getByRole("checkbox", { name: availableTag.displayName }));
    await user.click(screen.getByRole("button", { name: "Salvar etiquetas" }));
    expect(onSaveTags).toHaveBeenCalledWith(conversation.contact.id, []);
  });

  it("keeps empty labels quiet and never applies an unsafe inline color", () => {
    const { rerender } = render(
      <CustomerPanel
        {...tagProps}
        conversation={conversation}
        currentUserId="user-id"
        onSetResponsible={vi.fn()}
        users={[]}
      />,
    );
    expect(screen.getByText("Nenhuma etiqueta aplicada")).toBeVisible();

    rerender(
      <CustomerPanel
        {...tagProps}
        conversation={{
          ...conversation,
          contact: {
            ...conversation.contact,
            tags: [{ id: "unsafe", name: "Importada", color: "url(javascript:bad)", active: true }],
          },
        }}
        currentUserId="user-id"
        onSetResponsible={vi.fn()}
        users={[]}
      />,
    );
    expect(screen.getByText("Importada").closest("span")).not.toHaveAttribute("style");
  });

  it("uses a branded semantic contact summary that wraps long phone numbers and tags", () => {
    const longPhone = "+55 61 99999-9999 ramal-super-longo-sem-espacos";
    const longTag = "Etiqueta-muito-longa-sem-espacos-para-validar-quebra";
    render(
      <CustomerPanel
        {...tagProps}
        conversation={{
          ...conversation,
          contact: {
            ...conversation.contact,
            phone: longPhone,
            tags: [{ id: "long", name: longTag, color: "#176B52", active: true }],
          },
        }}
        currentUserId="user-id"
        onSetResponsible={vi.fn()}
        users={[]}
      />,
    );

    expect(screen.getByText("XP Atendimento")).toBeVisible();
    expect(screen.getByLabelText("Telefone de Carlos")).toHaveClass("break-all");
    expect(screen.getByLabelText("Etiquetas de Carlos")).toHaveClass("flex-wrap");
    expect(screen.getByText(longTag)).toHaveClass("whitespace-normal", "break-words");
    expect(screen.getByRole("button", { name: "Gerenciar etiquetas" })).toHaveClass("w-full");
  });
});
