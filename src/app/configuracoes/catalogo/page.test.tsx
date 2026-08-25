import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const redirect = vi.hoisted(() => vi.fn((path: string) => { throw new Error(`redirect:${path}`); }));
const getCurrentUser = vi.hoisted(() => vi.fn());
const getStatus = vi.hoisted(() => vi.fn());
const getCatalogService = vi.hoisted(() => vi.fn(() => ({ getStatus })));

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/modules/auth/session", () => ({ getCurrentUser }));
vi.mock("@/modules/catalog/factory", () => ({ getCatalogService }));
vi.mock("@/components/catalog/catalog-settings-screen", () => ({ CatalogSettingsScreen: () => <h1>Catálogo do WhatsApp</h1> }));
vi.mock("@/components/theme/theme-menu", () => ({ ThemeMenu: () => <button aria-label="Tema" type="button" /> }));

import CatalogSettingsError from "./error";
import CatalogSettingsLoading from "./loading";
import CatalogSettingsPage from "./page";

describe("catalog settings page", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redirects unauthenticated visitors before loading catalog data", async () => {
    getCurrentUser.mockResolvedValue(null);
    await expect(CatalogSettingsPage()).rejects.toThrow("redirect:/login");
    expect(getStatus).not.toHaveBeenCalled();
  });

  it("redirects attendants before loading admin data", async () => {
    getCurrentUser.mockResolvedValue({ id: "u", role: "ATTENDANT" });
    await expect(CatalogSettingsPage()).rejects.toThrow("redirect:/conversas");
    expect(getStatus).not.toHaveBeenCalled();
  });

  it("loads the catalog diagnostic for admins", async () => {
    const admin = { id: "a", name: "Victor", email: "a@x.test", role: "ADMIN" };
    getCurrentUser.mockResolvedValue(admin);
    getStatus.mockResolvedValue({ configured: false });
    render(await CatalogSettingsPage());
    expect(screen.getByRole("heading", { name: "Catálogo do WhatsApp" })).toBeVisible();
    expect(getStatus).toHaveBeenCalledWith(admin);
  });

  it("uses safe loading and error states", () => {
    const reset = vi.fn();
    const { rerender } = render(<CatalogSettingsLoading />);
    expect(screen.getByRole("status")).toHaveTextContent("Carregando catálogo do WhatsApp");
    rerender(<CatalogSettingsError error={new Error("Graph private token")} reset={reset} />);
    expect(screen.getByRole("heading", { name: "Não foi possível carregar o catálogo" })).toBeVisible();
    expect(document.body).not.toHaveTextContent("Graph private token");
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(reset).toHaveBeenCalledOnce();
  });
});
