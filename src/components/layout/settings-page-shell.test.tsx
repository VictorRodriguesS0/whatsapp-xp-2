import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/components/theme/theme-provider";

import { SettingsPageShell } from "./settings-page-shell";

describe("SettingsPageShell", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
      addEventListener: vi.fn(),
      matches: false,
      removeEventListener: vi.fn(),
    }));
  });

  it("renders navigation, brand, theme control, heading, and action slot", () => {
    render(
      <ThemeProvider>
        <SettingsPageShell
          actions={<button type="button">Nova configuração</button>}
          description="Gerencie a central."
          eyebrow="Configurações"
          title="Usuários"
        >
          <p>Conteúdo da página</p>
        </SettingsPageShell>
      </ThemeProvider>,
    );

    expect(screen.getByRole("link", { name: "Conversas" })).toHaveAttribute("href", "/conversas");
    expect(screen.getByLabelText("XP Eletrônicos")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tema" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Usuários" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Nova configuração" })).toBeVisible();
  });
});
