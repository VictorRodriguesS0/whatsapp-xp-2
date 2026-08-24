import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/components/theme/theme-provider";
import type { SessionUser } from "@/modules/auth/session";

import { ConversationSidebar } from "./conversation-sidebar";

const attendant: SessionUser = {
  id: "user-id",
  name: "Marcos",
  email: "marcos@xp.test",
  role: "ATTENDANT",
};

function renderSidebar(user: SessionUser = attendant) {
  const props = {
    user,
    searchMode: "conversations" as const,
    onSearchModeChange: vi.fn(),
    conversationList: <p>Lista existente</p>,
    messageSearchResults: <p>Resultados existentes</p>,
    conversationQuery: "Carlos",
    messageQuery: "produto",
    onConversationQueryChange: vi.fn(),
    onMessageQueryChange: vi.fn(),
    onLogout: vi.fn(),
  };
  return { ...render(<ThemeProvider><ConversationSidebar {...props} /></ThemeProvider>), props };
}

describe("ConversationSidebar", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("combines XP brand, theme and one accessible settings menu without changing the supplied list state", async () => {
    const { props } = renderSidebar();

    expect(screen.getByLabelText("XP Eletrônicos")).toBeVisible();
    expect(screen.getByRole("button", { name: "Tema" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Conversas" })).toHaveClass("min-h-11");
    expect(screen.getByRole("button", { name: "Mensagens" })).toHaveClass("min-h-11");
    expect(screen.getByRole("searchbox", { name: "Buscar conversas" })).toHaveValue("Carlos");
    expect(screen.getByText("Lista existente")).toBeVisible();
    expect(screen.queryByText("Resultados existentes")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Mensagens" }));
    expect(props.onSearchModeChange).toHaveBeenCalledWith("messages");

    await userEvent.setup().click(screen.getByRole("button", { name: "Abrir configurações" }));
    expect(screen.getByRole("menuitem", { name: "Configurar respostas rápidas" })).toHaveAttribute("href", "/configuracoes/respostas-rapidas");
    expect(screen.queryByRole("menuitem", { name: "Configurar classificações" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Configurar usuários" })).not.toBeInTheDocument();
  });

  it("keeps administrator-only settings inside the same menu", async () => {
    renderSidebar({ ...attendant, role: "ADMIN" });

    await userEvent.setup().click(screen.getByRole("button", { name: "Abrir configurações" }));
    expect(screen.getByRole("menuitem", { name: "Configurar classificações" })).toHaveAttribute("href", "/configuracoes/atendimento");
    expect(screen.getByRole("menuitem", { name: "Configurar usuários" })).toHaveAttribute("href", "/configuracoes/usuarios");
  });
});
