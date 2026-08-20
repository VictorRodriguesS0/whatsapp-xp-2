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

  it("keeps authenticated users out of the login page", async () => {
    getCurrentUserMock.mockResolvedValue({ id: "user-1" });

    await expect(LoginPage()).rejects.toThrow("redirect:/conversas");
    expect(redirectMock).toHaveBeenCalledWith("/conversas");
  });
});
