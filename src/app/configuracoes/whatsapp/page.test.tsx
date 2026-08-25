import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.hoisted(() =>
  vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
);
const getCurrentUserMock = vi.hoisted(() => vi.fn());
const getWhatsAppPolicySettingsMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock("@/modules/auth/session", () => ({
  getCurrentUser: getCurrentUserMock,
}));
vi.mock("@/modules/templates/service", () => ({
  getWhatsAppPolicySettings: getWhatsAppPolicySettingsMock,
}));

import WhatsAppSettingsError from "./error";
import WhatsAppSettingsLoading from "./loading";
import WhatsAppSettingsPage from "./page";

const settings = {
  mode: "INACTIVE",
  version: 0,
  lastSync: {
    status: "NEVER",
    attemptedAt: null,
    succeededAt: null,
    failureCode: null,
  },
  templates: [],
  assignment: null,
  canActivate: false,
  readinessReason: "NO_ASSIGNMENT",
};

describe("WhatsAppSettingsPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redirects anonymous and attendant users before loading policy data", async () => {
    getCurrentUserMock.mockResolvedValueOnce(null);
    await expect(WhatsAppSettingsPage()).rejects.toThrow("redirect:/login");
    getCurrentUserMock.mockResolvedValueOnce({
      id: "attendant",
      name: "Ana",
      email: "ana@example.test",
      role: "ATTENDANT",
    });
    await expect(WhatsAppSettingsPage()).rejects.toThrow(
      "redirect:/conversas",
    );
    expect(getWhatsAppPolicySettingsMock).not.toHaveBeenCalled();
  });

  it("loads the safe policy dashboard for an administrator", async () => {
    const admin = {
      id: "admin",
      name: "Victor",
      email: "victor@example.test",
      role: "ADMIN",
    };
    getCurrentUserMock.mockResolvedValue(admin);
    getWhatsAppPolicySettingsMock.mockResolvedValue(settings);

    render(await WhatsAppSettingsPage());

    expect(
      screen.getByRole("heading", {
        name: "WhatsApp e janela de atendimento",
      }),
    ).toBeVisible();
    expect(getWhatsAppPolicySettingsMock).toHaveBeenCalledWith(admin);
  });

  it("uses route-specific loading and sanitized error states", () => {
    const reset = vi.fn();
    const { rerender } = render(<WhatsAppSettingsLoading />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Carregando configuração do WhatsApp",
    );

    rerender(
      <WhatsAppSettingsError
        error={new Error("Graph token=secret")}
        reset={reset}
      />,
    );
    expect(
      screen.getByRole("heading", {
        name: "Não foi possível carregar a configuração do WhatsApp",
      }),
    ).toBeVisible();
    expect(screen.queryByText(/Graph|token=secret/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(reset).toHaveBeenCalledOnce();
  });
});
