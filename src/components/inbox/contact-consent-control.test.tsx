import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { ContactMessagingConsentSource } from "@/generated/prisma/enums";

import { ContactConsentControl } from "./contact-consent-control";

const contactId = "10000000-0000-4000-8000-000000000001";
const inactiveConsent = {
  active: false,
  source: null,
  grantedAt: null,
  grantedBy: null,
  note: null,
} as const;
const activeConsent = {
  active: true,
  source: ContactMessagingConsentSource.LOJA_FISICA,
  grantedAt: "2026-08-25T10:30:00.000Z",
  grantedBy: {
    id: "30000000-0000-4000-8000-000000000001",
    name: "Marcos",
  },
  note: null,
} as const;

beforeAll(() => {
  Object.defineProperties(HTMLElement.prototype, {
    hasPointerCapture: { configurable: true, value: () => false },
    releasePointerCapture: { configurable: true, value: () => undefined },
    scrollIntoView: { configurable: true, value: () => undefined },
    setPointerCapture: { configurable: true, value: () => undefined },
  });
});

describe("ContactConsentControl", () => {
  it("shows inactive status and all four official source choices", async () => {
    const user = userEvent.setup();
    render(
      <ContactConsentControl
        consent={inactiveConsent}
        contactId={contactId}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Sem autorização registrada")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Registrar autorização" }));
    await user.click(screen.getByRole("combobox", { name: "Origem da autorização" }));
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "WhatsApp",
      "Loja física",
      "Telefone",
      "Outro",
    ]);
  });

  it("requires and trims the OUTRO note before an explicit grant", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn().mockResolvedValue(true);
    render(
      <ContactConsentControl
        consent={inactiveConsent}
        contactId={contactId}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Registrar autorização" }));
    await user.click(screen.getByRole("combobox", { name: "Origem da autorização" }));
    await user.click(screen.getByRole("option", { name: "Outro" }));
    expect(screen.getByRole("button", { name: "Confirmar autorização" })).toBeDisabled();
    await user.type(
      screen.getByRole("textbox", { name: "Como a autorização foi obtida" }),
      "  Feira de tecnologia  ",
    );
    await user.click(screen.getByRole("button", { name: "Confirmar autorização" }));

    expect(onChange).toHaveBeenCalledWith(contactId, {
      action: "GRANT",
      source: ContactMessagingConsentSource.OUTRO,
      note: "Feira de tecnologia",
    });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("shows the authoritative actor and date and revokes explicitly", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn().mockResolvedValue(true);
    render(
      <ContactConsentControl
        consent={activeConsent}
        contactId={contactId}
        onChange={onChange}
      />,
    );

    expect(
      screen.getByText("Autorizado em 25/08/2026, 07:30 por Marcos"),
    ).toBeVisible();
    expect(screen.getByText("Loja física")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Revogar autorização" }));
    await user.click(screen.getByRole("button", { name: "Confirmar revogação" }));
    expect(onChange).toHaveBeenCalledWith(contactId, { action: "REVOKE" });
  });

  it("blocks duplicate submission while the first save is unresolved", async () => {
    let resolve!: (saved: boolean) => void;
    const onChange = vi.fn(
      () => new Promise<boolean>((done) => {
        resolve = done;
      }),
    );
    const user = userEvent.setup();
    render(
      <ContactConsentControl
        consent={inactiveConsent}
        contactId={contactId}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Registrar autorização" }));
    const confirm = screen.getByRole("button", { name: "Confirmar autorização" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Salvando…" })).toBeDisabled();
    resolve(true);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("keeps a server error visible without closing the dialog", async () => {
    const user = userEvent.setup();
    render(
      <ContactConsentControl
        consent={inactiveConsent}
        contactId={contactId}
        error="Este contato está marcado como não contatar."
        onChange={vi.fn().mockResolvedValue(false)}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Registrar autorização" }));
    await user.click(screen.getByRole("button", { name: "Confirmar autorização" }));
    expect(screen.getByRole("alertdialog")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Este contato está marcado como não contatar.",
    );
  });

  it("closes with Escape and restores focus to the trigger", async () => {
    const user = userEvent.setup();
    render(
      <ContactConsentControl
        consent={inactiveConsent}
        contactId={contactId}
        onChange={vi.fn()}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Registrar autorização" });

    await user.click(trigger);
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("uses a viewport-bounded dialog suitable for a 390px screen", async () => {
    const user = userEvent.setup();
    render(
      <ContactConsentControl
        consent={inactiveConsent}
        contactId={contactId}
        onChange={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Registrar autorização" }));

    expect(screen.getByRole("alertdialog")).toHaveClass(
      "w-[calc(100%-2rem)]",
      "max-w-md",
    );
    expect(screen.getByRole("button", { name: "Confirmar autorização" })).toHaveClass(
      "w-full",
    );
  });
});
