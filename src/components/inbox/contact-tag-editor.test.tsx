import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ContactTagEditor } from "./contact-tag-editor";

const waiting = {
  id: "10000000-0000-4000-8000-000000000001",
  displayName: "Aguardando produto",
  color: "#176B52",
  position: 10,
  active: true,
};

const priority = {
  id: "10000000-0000-4000-8000-000000000002",
  displayName: "Prioridade",
  color: "#B4443C",
  position: 20,
  active: true,
};

const assignedWaiting = {
  id: waiting.id,
  name: waiting.displayName,
  color: waiting.color,
  active: true,
};

const baseProps = {
  contactId: "20000000-0000-4000-8000-000000000001",
  assignedTags: [assignedWaiting],
  availableTags: [waiting, priority],
  loading: false,
  pending: false,
  error: null,
  onRetryLoad: vi.fn(),
  onSave: vi.fn().mockResolvedValue(true),
};

describe("ContactTagEditor", () => {
  it("opens an accessible checklist, changes the complete set and saves explicitly", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(true);
    render(<ContactTagEditor {...baseProps} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: "Gerenciar etiquetas" }));

    expect(screen.getByRole("dialog", { name: "Gerenciar etiquetas" })).toBeVisible();
    expect(screen.getByRole("checkbox", { name: waiting.displayName })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: priority.displayName })).not.toBeChecked();
    await user.click(screen.getByRole("checkbox", { name: priority.displayName }));
    await user.click(screen.getByRole("button", { name: "Salvar etiquetas" }));

    expect(onSave).toHaveBeenCalledWith(baseProps.contactId, [waiting.id, priority.id]);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("can clear every label and suppresses duplicate submission while pending", async () => {
    const user = userEvent.setup();
    let resolveSave!: (saved: boolean) => void;
    const onSave = vi.fn().mockImplementation(() => new Promise<boolean>((resolve) => {
      resolveSave = resolve;
    }));
    const { rerender } = render(<ContactTagEditor {...baseProps} onSave={onSave} />);
    await user.click(screen.getByRole("button", { name: "Gerenciar etiquetas" }));
    await user.click(screen.getByRole("checkbox", { name: waiting.displayName }));

    await user.click(screen.getByRole("button", { name: "Salvar etiquetas" }));
    rerender(<ContactTagEditor {...baseProps} onSave={onSave} pending />);

    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave).toHaveBeenCalledWith(baseProps.contactId, []);
    expect(screen.getByRole("button", { name: "Salvando etiquetas" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Salvando etiquetas" }));
    expect(onSave).toHaveBeenCalledOnce();
    resolveSave(true);
  });

  it("keeps the draft open after failure and allows retry", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const { rerender } = render(<ContactTagEditor {...baseProps} onSave={onSave} />);
    await user.click(screen.getByRole("button", { name: "Gerenciar etiquetas" }));
    await user.click(screen.getByRole("checkbox", { name: priority.displayName }));
    await user.click(screen.getByRole("button", { name: "Salvar etiquetas" }));

    expect(screen.getByRole("dialog", { name: "Gerenciar etiquetas" })).toBeVisible();
    rerender(<ContactTagEditor {...baseProps} error="Não foi possível salvar as etiquetas." onSave={onSave} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível salvar as etiquetas.");

    await user.click(screen.getByRole("button", { name: "Salvar etiquetas" }));
    expect(onSave).toHaveBeenNthCalledWith(2, baseProps.contactId, [waiting.id, priority.id]);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("cancels without saving and restores focus to the trigger", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<ContactTagEditor {...baseProps} onSave={onSave} />);
    const trigger = screen.getByRole("button", { name: "Gerenciar etiquetas" });
    await user.click(trigger);
    await user.click(screen.getByRole("checkbox", { name: priority.displayName }));
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(onSave).not.toHaveBeenCalled();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("offers catalog retry and explains that unavailable assigned labels will be removed", async () => {
    const user = userEvent.setup();
    const onRetryLoad = vi.fn();
    render(
      <ContactTagEditor
        {...baseProps}
        assignedTags={[{ id: "inactive", name: "Etiqueta antiga", color: "#2458A6", active: false }]}
        availableTags={[]}
        error="Não foi possível carregar as etiquetas."
        onRetryLoad={onRetryLoad}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Gerenciar etiquetas" }));

    expect(screen.getByText("Etiqueta antiga")).toBeVisible();
    expect(screen.getByText(/será removida ao salvar/i)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(onRetryLoad).toHaveBeenCalledOnce();
  });

  it("resets a discarded draft when the selected contact changes", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ContactTagEditor {...baseProps} />);
    await user.click(screen.getByRole("button", { name: "Gerenciar etiquetas" }));
    await user.click(screen.getByRole("checkbox", { name: priority.displayName }));
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    rerender(
      <ContactTagEditor
        {...baseProps}
        assignedTags={[]}
        contactId="20000000-0000-4000-8000-000000000002"
      />,
    );
    await user.click(screen.getByRole("button", { name: "Gerenciar etiquetas" }));
    expect(screen.getByRole("checkbox", { name: waiting.displayName })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: priority.displayName })).not.toBeChecked();
  });
});
