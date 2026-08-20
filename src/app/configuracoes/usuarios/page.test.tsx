import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.hoisted(() => vi.fn((path: string) => { throw new Error(`redirect:${path}`); }));
const routerReplaceMock = vi.hoisted(() => vi.fn());
const getCurrentUserMock = vi.hoisted(() => vi.fn());
const listUsersMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ redirect: redirectMock, useRouter: () => ({ replace: routerReplaceMock }) }));
vi.mock("@/modules/auth/session", () => ({ getCurrentUser: getCurrentUserMock }));
vi.mock("@/modules/users/service", () => ({ listUsers: listUsersMock }));

import UsersPage from "./page";

describe("UsersPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redirects an unauthenticated visitor to login", async () => {
    getCurrentUserMock.mockResolvedValue(null);
    await expect(UsersPage()).rejects.toThrow("redirect:/login");
    expect(listUsersMock).not.toHaveBeenCalled();
  });

  it("redirects an attendant to conversations", async () => {
    getCurrentUserMock.mockResolvedValue({ id: "a", name: "Ana", email: "ana@xp.test", role: "ATTENDANT" });
    await expect(UsersPage()).rejects.toThrow("redirect:/conversas");
    expect(listUsersMock).not.toHaveBeenCalled();
  });

  it("renders the server-loaded administrator directory", async () => {
    const admin = { id: "admin", name: "Victor", email: "victor@xp.test", role: "ADMIN" };
    getCurrentUserMock.mockResolvedValue(admin);
    listUsersMock.mockResolvedValue([{ id: "u", name: "Marcos", email: "marcos@xp.test", role: "ATTENDANT", active: true, createdAt: new Date(), updatedAt: new Date() }]);

    render(await UsersPage());

    expect(screen.getByRole("heading", { name: "Usuários" })).toBeVisible();
    expect(listUsersMock).toHaveBeenCalledWith(admin);
  });
});
