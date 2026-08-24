import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentUserMock, redirectMock } = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  redirectMock: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock("@/modules/auth/session", () => ({ getCurrentUser: getCurrentUserMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/components/theme/theme-menu", () => ({ ThemeMenu: () => <button aria-label="Tema" type="button" /> }));

import LoginPage from "./page";

describe("login page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentUserMock.mockResolvedValue(null);
  });

  it("links the public privacy and data-deletion documents", async () => {
    render(await LoginPage());

    expect(screen.getByRole("link", { name: "Privacidade" })).toHaveAttribute("href", "/privacidade");
    expect(screen.getByRole("link", { name: "Exclusão de dados" })).toHaveAttribute("href", "/exclusao-de-dados");
  });

  it("presents local XP branding, theme control and an operational value statement", async () => {
    render(await LoginPage());

    expect(screen.getAllByLabelText("XP Eletrônicos").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("img", { name: "Símbolo XP" }).every((image) => image.getAttribute("src") === "/brand/xp-symbol.png")).toBe(true);
    expect(screen.getByRole("button", { name: "Tema" })).toBeVisible();
    expect(screen.getAllByText("Atendimento organizado, contexto preservado.")).toHaveLength(2);
    expect(document.querySelector(".login-layout")).toBeInTheDocument();
    expect(document.querySelector(".login-card")).toBeInTheDocument();
  });

  it("keeps authenticated users out of the login page", async () => {
    getCurrentUserMock.mockResolvedValue({ id: "user-1" });

    await expect(LoginPage()).rejects.toThrow("redirect:/conversas");
    expect(redirectMock).toHaveBeenCalledWith("/conversas");
  });
});
