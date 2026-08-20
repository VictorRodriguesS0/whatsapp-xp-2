import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ResetPasswordForm } from "./reset-password-form";
import { UserForm } from "./user-form";

describe("UserForm", () => {
  it("validates the create fields in Portuguese before submitting", () => {
    const onSubmit = vi.fn();
    render(<UserForm mode="create" onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole("button", { name: "Criar usuário" }));

    expect(screen.getByText("Informe o nome.")).toBeVisible();
    expect(screen.getByText("Informe um e-mail válido.")).toBeVisible();
    expect(screen.getByText("A senha deve ter pelo menos 10 caracteres.")).toBeVisible();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits normalized create values and exposes accessible labels", () => {
    const onSubmit = vi.fn();
    render(<UserForm mode="create" onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "  Ana Souza  " } });
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "  ANA@XP.TEST  " } });
    fireEvent.change(screen.getByLabelText("Senha inicial"), { target: { value: "Senha-2026!" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar usuário" }));

    expect(onSubmit).toHaveBeenCalledWith({
      name: "Ana Souza",
      email: "ana@xp.test",
      password: "Senha-2026!",
      role: "ATTENDANT",
    });
  });

  it("submits only the edited fields compared with the initial snapshot", () => {
    const onSubmit = vi.fn();
    render(
      <UserForm
        initialUser={{ id: "user-1", name: "Marcos", email: "marcos@xp.test", role: "ATTENDANT", active: true }}
        mode="edit"
        onSubmit={onSubmit}
      />,
    );

    expect(screen.queryByLabelText(/senha/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Marcos Lima" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));

    expect(onSubmit).toHaveBeenCalledWith({ name: "Marcos Lima" });
  });

  it("keeps the edit open and explains when there is nothing to save", () => {
    const onSubmit = vi.fn();
    render(
      <UserForm
        initialUser={{ id: "user-1", name: "Marcos", email: "marcos@xp.test", role: "ATTENDANT", active: true }}
        mode="edit"
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Nenhuma alteração para salvar.");
  });
});

describe("ResetPasswordForm", () => {
  it("requires ten matching characters", () => {
    const onSubmit = vi.fn();
    render(<ResetPasswordForm onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText("Nova senha"), { target: { value: "curta" } });
    fireEvent.change(screen.getByLabelText("Confirmar nova senha"), { target: { value: "diferente" } });
    fireEvent.click(screen.getByRole("button", { name: "Redefinir senha" }));

    expect(screen.getByText("A senha deve ter pelo menos 10 caracteres.")).toBeVisible();
    expect(screen.getByText("As senhas não coincidem.")).toBeVisible();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
