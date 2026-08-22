import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { ContactTypeSelector } from "./contact-type-selector";

const contactId = "20000000-0000-4000-8000-000000000001";
const availableType = {
  id: "10000000-0000-4000-8000-000000000001",
  displayName: "Cliente",
  color: "#176B52",
  position: 10,
  active: true,
};
const currentType = {
  id: availableType.id,
  name: availableType.displayName,
  color: availableType.color,
  active: true,
};

const defaultProps = {
  availableTypes: [availableType],
  contactId,
  currentType: null,
  loadError: null,
  loading: false,
  onChange: vi.fn().mockResolvedValue(true),
  onRetryLoad: vi.fn(),
  pending: false,
  saveError: null,
};

beforeAll(() => {
  Object.defineProperties(HTMLElement.prototype, {
    hasPointerCapture: { configurable: true, value: () => false },
    releasePointerCapture: { configurable: true, value: () => undefined },
    scrollIntoView: { configurable: true, value: () => undefined },
    setPointerCapture: { configurable: true, value: () => undefined },
  });
});

describe("ContactTypeSelector", () => {
  it("shows the server-confirmed empty and current states", () => {
    const { rerender } = render(<ContactTypeSelector {...defaultProps} />);
    expect(screen.getAllByText("Sem tipo").length).toBeGreaterThan(0);

    rerender(<ContactTypeSelector {...defaultProps} currentType={currentType} />);
    expect(screen.getByTitle("Cliente")).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Tipo de contato" })).toHaveTextContent(
      "Cliente",
    );
  });

  it("selects one active type", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn().mockResolvedValue(true);
    render(<ContactTypeSelector {...defaultProps} onChange={onChange} />);

    await user.click(screen.getByRole("combobox", { name: "Tipo de contato" }));
    await user.click(screen.getByRole("option", { name: "Cliente" }));

    expect(onChange).toHaveBeenCalledWith(contactId, availableType.id);
  });

  it("clears the current type with null", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn().mockResolvedValue(true);
    render(
      <ContactTypeSelector
        {...defaultProps}
        currentType={currentType}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "Tipo de contato" }));
    await user.click(screen.getByRole("option", { name: "Sem tipo" }));

    expect(onChange).toHaveBeenCalledWith(contactId, null);
  });

  it("disables changes while loading or saving and announces progress", () => {
    const { rerender } = render(
      <ContactTypeSelector {...defaultProps} loading />,
    );
    expect(screen.getByRole("combobox", { name: "Tipo de contato" })).toBeDisabled();

    rerender(<ContactTypeSelector {...defaultProps} pending />);
    expect(screen.getByRole("combobox", { name: "Tipo de contato" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Atualizando tipo de contato");
  });

  it("shows safe load and save failures and wires catalog retry", async () => {
    const user = userEvent.setup();
    const onRetryLoad = vi.fn();
    const { rerender } = render(
      <ContactTypeSelector
        {...defaultProps}
        loadError="Não foi possível carregar os tipos de contato."
        onRetryLoad={onRetryLoad}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Tipo de contato" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Não foi possível carregar os tipos de contato.",
    );
    await user.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(onRetryLoad).toHaveBeenCalledOnce();

    rerender(
      <ContactTypeSelector
        {...defaultProps}
        saveError="Não foi possível atualizar o tipo de contato."
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Não foi possível atualizar o tipo de contato.",
    );
  });

  it("keeps an assigned inactive type visible but unavailable for selection", async () => {
    const user = userEvent.setup();
    const inactiveType = {
      id: "10000000-0000-4000-8000-000000000002",
      name: "Fornecedor",
      color: "#6B7280",
      active: false,
    };
    render(
      <ContactTypeSelector
        {...defaultProps}
        currentType={inactiveType}
      />,
    );

    expect(screen.getByTitle("Fornecedor")).toBeVisible();
    await user.click(screen.getByRole("combobox", { name: "Tipo de contato" }));
    expect(
      screen.getByRole("option", { name: "Fornecedor (inativo)" }),
    ).toHaveAttribute("data-disabled");
  });
});
