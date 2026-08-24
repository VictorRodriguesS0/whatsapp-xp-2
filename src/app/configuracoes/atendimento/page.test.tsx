import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.hoisted(() => vi.fn((path: string) => { throw new Error(`redirect:${path}`); }));
const getCurrentUserMock = vi.hoisted(() => vi.fn());
const listContactTypesMock = vi.hoisted(() => vi.fn());
const listContactTagsMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ redirect: redirectMock, useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/modules/auth/session", () => ({ getCurrentUser: getCurrentUserMock }));
vi.mock("@/modules/contacts/service", () => ({
  listContactTags: listContactTagsMock,
  listContactTypes: listContactTypesMock,
}));
vi.mock("@/components/theme/theme-menu", () => ({ ThemeMenu: () => <button aria-label="Tema" type="button" /> }));

import ClassificationError from "./error";
import ClassificationLoading from "./loading";
import ContactClassificationPage from "./page";

describe("ContactClassificationPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redirects an unauthenticated visitor before loading settings", async () => {
    getCurrentUserMock.mockResolvedValue(null);
    await expect(ContactClassificationPage()).rejects.toThrow("redirect:/login");
    expect(listContactTypesMock).not.toHaveBeenCalled();
    expect(listContactTagsMock).not.toHaveBeenCalled();
  });

  it("redirects an attendant before loading admin settings", async () => {
    getCurrentUserMock.mockResolvedValue({ id: "a", name: "Ana", email: "ana@xp.test", role: "ATTENDANT" });
    await expect(ContactClassificationPage()).rejects.toThrow("redirect:/conversas");
    expect(listContactTypesMock).not.toHaveBeenCalled();
    expect(listContactTagsMock).not.toHaveBeenCalled();
  });

  it("loads both collections for the authenticated administrator", async () => {
    const admin = { id: "admin", name: "Victor", email: "victor@xp.test", role: "ADMIN" };
    getCurrentUserMock.mockResolvedValue(admin);
    listContactTypesMock.mockResolvedValue([{ id: "type", displayName: "Cliente", color: "#2458A6", position: 0, active: true }]);
    listContactTagsMock.mockResolvedValue([{ id: "tag", displayName: "Prioridade", color: "#B4443C", position: 0, active: true }]);

    render(await ContactClassificationPage());

    expect(screen.getByRole("heading", { name: "Classificação do atendimento" })).toBeVisible();
    expect(listContactTypesMock).toHaveBeenCalledWith(admin);
    expect(listContactTagsMock).toHaveBeenCalledWith(admin);
  });

  it("uses route-specific safe loading and error states", () => {
    const reset = vi.fn();
    const { rerender } = render(<ClassificationLoading />);
    expect(screen.getByRole("status")).toHaveTextContent("Carregando classificações");

    rerender(<ClassificationError error={new Error("Prisma database secret")} reset={reset} />);
    expect(screen.getByRole("heading", { name: "Não foi possível carregar as classificações" })).toBeVisible();
    expect(screen.queryByText(/Prisma|database secret/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(reset).toHaveBeenCalledOnce();
  });
});
