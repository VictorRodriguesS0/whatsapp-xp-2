import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "./theme-provider";
import { ThemeMenu } from "./theme-menu";

describe("ThemeMenu", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
      addEventListener: vi.fn(),
      matches: false,
      removeEventListener: vi.fn(),
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("exposes the current preference as a checked radio item", async () => {
    const user = userEvent.setup();
    render(<ThemeProvider><ThemeMenu /></ThemeProvider>);

    await user.click(screen.getByRole("button", { name: "Tema" }));

    expect(screen.getByRole("menuitemradio", { name: "Seguir o sistema" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemradio", { name: "Claro" })).toHaveAttribute("aria-checked", "false");
  });

  it("changes the selected preference", async () => {
    const user = userEvent.setup();
    render(<ThemeProvider><ThemeMenu /></ThemeProvider>);

    await user.click(screen.getByRole("button", { name: "Tema" }));
    await user.click(screen.getByRole("menuitemradio", { name: "Escuro" }));

    await waitFor(() => expect(document.documentElement).toHaveAttribute("data-theme", "dark"));
    expect(localStorage.getItem("xp-atendimento-theme")).toBe("dark");
  });
});
