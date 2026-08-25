import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ServiceWindowDto } from "@/modules/messaging-policy/types";

import { ServiceWindowBanner } from "./service-window-banner";

const resumable: ServiceWindowDto = {
  enforcement: "ACTIVE",
  status: "CLOSED",
  closesAt: "2026-08-23T12:00:00.000Z",
  sendMode: "RESUMPTION",
  reason: "WINDOW_EXPIRED",
  resumption: {
    templateName: "retomar_atendimento",
    language: "pt_BR",
    previewBody: "Olá, Carlos! Podemos continuar o atendimento?",
  },
};

describe("ServiceWindowBanner", () => {
  it("supports policy transitions between inactive and active without changing hook order", () => {
    const view = render(
      <ServiceWindowBanner
        onResume={vi.fn().mockResolvedValue(true)}
        serviceWindow={{
          enforcement: "INACTIVE",
          status: "CLOSED",
          closesAt: null,
          sendMode: "FREE_FORM",
          reason: null,
          resumption: null,
        }}
      />,
    );

    expect(screen.queryByRole("region", { name: "Janela de atendimento do WhatsApp" })).not.toBeInTheDocument();
    expect(() => view.rerender(
      <ServiceWindowBanner
        onResume={vi.fn().mockResolvedValue(true)}
        serviceWindow={resumable}
      />,
    )).not.toThrow();
    expect(screen.getByRole("region", { name: "Janela de atendimento do WhatsApp" })).toBeVisible();
    expect(() => view.rerender(
      <ServiceWindowBanner
        onResume={vi.fn().mockResolvedValue(true)}
        serviceWindow={{
          enforcement: "INACTIVE",
          status: "CLOSED",
          closesAt: null,
          sendMode: "FREE_FORM",
          reason: null,
          resumption: null,
        }}
      />,
    )).not.toThrow();
  });

  it("requires an explicit confirmation and repeats the exact server preview", async () => {
    const user = userEvent.setup();
    const onResume = vi.fn().mockResolvedValue(true);
    render(
      <ServiceWindowBanner
        onResume={onResume}
        serviceWindow={resumable}
      />,
    );

    expect(screen.getByText("Janela encerrada — use um template")).toBeVisible();
    expect(screen.getByText(resumable.resumption!.previewBody)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Retomar atendimento" }));
    expect(onResume).not.toHaveBeenCalled();

    const dialog = screen.getByRole("alertdialog", { name: "Enviar template de retomada?" });
    expect(within(dialog).getByText(resumable.resumption!.previewBody)).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Enviar template" }));
    expect(onResume).toHaveBeenCalledOnce();
  });

  it("keeps the confirmation open when the resumption is not accepted", async () => {
    const user = userEvent.setup();
    const onResume = vi.fn().mockResolvedValue(false);
    render(
      <ServiceWindowBanner
        error="Não foi possível retomar o atendimento. Tente novamente."
        onResume={onResume}
        serviceWindow={resumable}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Retomar atendimento" }));
    await user.click(screen.getByRole("button", { name: "Enviar template" }));

    expect(onResume).toHaveBeenCalledOnce();
    const dialog = screen.getByRole("alertdialog", { name: "Enviar template de retomada?" });
    expect(dialog).toBeVisible();
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Não foi possível retomar o atendimento. Tente novamente.",
    );
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(1);
  });

  it("closes the confirmation and restores safe focus when the same conversation loses eligibility", async () => {
    const user = userEvent.setup();
    const view = render(
      <ServiceWindowBanner
        onResume={vi.fn().mockResolvedValue(true)}
        serviceWindow={resumable}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Retomar atendimento" }));

    view.rerender(
      <ServiceWindowBanner
        onResume={vi.fn().mockResolvedValue(true)}
        serviceWindow={{
          ...resumable,
          sendMode: "CONFIRMING",
          reason: null,
          resumption: null,
        }}
      />,
    );

    await waitFor(() => expect(
      screen.queryByRole("alertdialog", { name: "Enviar template de retomada?" }),
    ).not.toBeInTheDocument());
    expect(screen.getByRole("region", { name: "Janela de atendimento do WhatsApp" })).toHaveFocus();
  });

  it.each([
    ["AWAITING_CUSTOMER", "Aguardando cliente"],
    ["CONFIRMING", "Retomada em confirmação"],
    ["BLOCKED", "Retomada indisponível"],
  ] as const)("renders the %s authoritative state without a send action", (sendMode, copy) => {
    render(
      <ServiceWindowBanner
        onResume={vi.fn().mockResolvedValue(true)}
        serviceWindow={{
          ...resumable,
          sendMode,
          resumption: null,
          reason: sendMode === "BLOCKED" ? "CONTACT_OPTED_OUT" : null,
        }}
      />,
    );

    expect(screen.getByText(copy)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Retomar atendimento" })).not.toBeInTheDocument();
  });
});
