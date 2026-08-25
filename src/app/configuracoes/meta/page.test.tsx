import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const redirect = vi.hoisted(() => vi.fn((path: string) => { throw new Error(`redirect:${path}`); }));
const getCurrentUser = vi.hoisted(() => vi.fn());
const getMetaHealthSummary = vi.hoisted(() => vi.fn());
const listMetaHealthAlerts = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/modules/auth/session", () => ({ getCurrentUser }));
vi.mock("@/modules/meta-health/service", () => ({ getMetaHealthSummary, listMetaHealthAlerts }));
vi.mock("@/components/meta-health/meta-health-screen", () => ({ MetaHealthScreen: () => <h1>Saúde da Meta</h1> }));
vi.mock("@/components/theme/theme-menu", () => ({ ThemeMenu: () => <button aria-label="Tema" type="button" /> }));

import MetaHealthError from "./error";
import MetaHealthLoading from "./loading";
import MetaHealthPage from "./page";

describe("Meta health settings page", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redirects unauthenticated visitors before loading data", async () => {
    getCurrentUser.mockResolvedValue(null);
    await expect(MetaHealthPage()).rejects.toThrow("redirect:/login");
    expect(getMetaHealthSummary).not.toHaveBeenCalled();
  });

  it("redirects attendants before loading admin data", async () => {
    getCurrentUser.mockResolvedValue({ id: "u", role: "ATTENDANT" });
    await expect(MetaHealthPage()).rejects.toThrow("redirect:/conversas");
    expect(getMetaHealthSummary).not.toHaveBeenCalled();
  });

  it("loads summary and first history page in parallel for admins", async () => {
    const admin = { id: "a", name: "Victor", email: "a@x.test", role: "ADMIN" };
    getCurrentUser.mockResolvedValue(admin);
    getMetaHealthSummary.mockResolvedValue({ label: "NORMAL" });
    listMetaHealthAlerts.mockResolvedValue({ alerts: [], nextCursor: null });
    render(await MetaHealthPage());
    expect(screen.getByRole("heading", { name: "Saúde da Meta" })).toBeVisible();
    expect(getMetaHealthSummary).toHaveBeenCalledWith(admin);
    expect(listMetaHealthAlerts).toHaveBeenCalledWith(admin, { limit: 30 });
  });

  it("uses safe loading and error states", () => {
    const reset = vi.fn();
    const { rerender } = render(<MetaHealthLoading />);
    expect(screen.getByRole("status")).toHaveTextContent("Carregando saúde da Meta");
    rerender(<MetaHealthError error={new Error("Graph private token")} reset={reset} />);
    expect(screen.getByRole("heading", { name: "Não foi possível carregar a saúde da Meta" })).toBeVisible();
    expect(document.body).not.toHaveTextContent("Graph private token");
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(reset).toHaveBeenCalledOnce();
  });
});
