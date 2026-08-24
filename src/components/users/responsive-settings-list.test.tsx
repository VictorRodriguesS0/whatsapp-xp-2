import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ResponsiveSettingsList } from "./responsive-settings-list";

const currentUser = {
  id: "admin-1",
  name: "Victor",
  email: "victor@xp.test",
  role: "ADMIN" as const,
  active: true,
};

const attendant = {
  id: "user-2",
  name: "Marcos",
  email: "marcos@xp.test",
  role: "ATTENDANT" as const,
  active: true,
};

describe("ResponsiveSettingsList", () => {
  it("renders synchronized semantic desktop and mobile representations", () => {
    render(
      <ResponsiveSettingsList
        busy={false}
        currentUserId={currentUser.id}
        onChangeAccess={vi.fn()}
        onEdit={vi.fn()}
        onResetPassword={vi.fn()}
        users={[currentUser, attendant]}
      />,
    );

    const desktop = screen.getByTestId("users-desktop-list");
    const mobile = screen.getByRole("list", { name: "Funcionários" });

    expect(desktop).toHaveClass("hidden", "md:block");
    expect(within(desktop).getByRole("table")).toBeInTheDocument();
    expect(within(desktop).getByRole("columnheader", { name: "Nome" })).toBeVisible();
    expect(within(desktop).getByRole("columnheader", { name: "E-mail" })).toBeVisible();
    expect(mobile).toHaveClass("grid", "md:hidden");
    expect(within(mobile).getAllByRole("listitem")).toHaveLength(2);

    for (const representation of [desktop, mobile]) {
      expect(within(representation).getAllByText("Marcos").length).toBeGreaterThan(0);
      expect(within(representation).getByText("marcos@xp.test")).toBeInTheDocument();
      expect(within(representation).getByText("Atendente")).toBeInTheDocument();
      expect(within(representation).getAllByText("Ativo").length).toBeGreaterThan(0);
      expect(within(representation).queryByRole("button", { name: /excluir/i })).not.toBeInTheDocument();
    }
  });

  it("uses the same callbacks and 44px labeled actions in both layouts", () => {
    const onEdit = vi.fn();
    const onResetPassword = vi.fn();
    const onChangeAccess = vi.fn();
    render(
      <ResponsiveSettingsList
        busy={false}
        currentUserId={currentUser.id}
        onChangeAccess={onChangeAccess}
        onEdit={onEdit}
        onResetPassword={onResetPassword}
        users={[attendant]}
      />,
    );

    const desktop = screen.getByTestId("users-desktop-list");
    const mobile = screen.getByRole("list", { name: "Funcionários" });
    const mobileActions = screen.getByLabelText("Ações para Marcos");

    expect(mobileActions).toHaveClass("grid-cols-1", "min-[390px]:grid-cols-2");

    fireEvent.click(within(desktop).getByRole("button", { name: "Editar Marcos" }));
    fireEvent.click(within(mobile).getByRole("button", { name: "Editar Marcos" }));
    fireEvent.click(within(desktop).getByRole("button", { name: "Redefinir senha de Marcos" }));
    fireEvent.click(within(mobile).getByRole("button", { name: "Redefinir senha de Marcos" }));
    fireEvent.click(within(desktop).getByRole("button", { name: "Desativar Marcos" }));
    fireEvent.click(within(mobile).getByRole("button", { name: "Desativar Marcos" }));

    expect(onEdit).toHaveBeenCalledTimes(2);
    expect(onResetPassword).toHaveBeenCalledTimes(2);
    expect(onChangeAccess).toHaveBeenCalledTimes(2);
    for (const button of within(mobile).getAllByRole("button")) {
      expect(button).toHaveClass("min-h-11");
    }
  });

  it("prevents self-deactivation in both representations", () => {
    render(
      <ResponsiveSettingsList
        busy={false}
        currentUserId={currentUser.id}
        onChangeAccess={vi.fn()}
        onEdit={vi.fn()}
        onResetPassword={vi.fn()}
        users={[currentUser]}
      />,
    );

    for (const representation of [screen.getByTestId("users-desktop-list"), screen.getByRole("list", { name: "Funcionários" })]) {
      expect(within(representation).queryByRole("button", { name: "Desativar Victor" })).not.toBeInTheDocument();
      expect(within(representation).getByText("Sua conta atual")).toBeInTheDocument();
    }
  });

  it("does not encode horizontal scrolling or a fixed mobile table width", () => {
    render(
      <ResponsiveSettingsList
        busy={false}
        currentUserId={currentUser.id}
        onChangeAccess={vi.fn()}
        onEdit={vi.fn()}
        onResetPassword={vi.fn()}
        users={[attendant]}
      />,
    );

    expect(screen.getByTestId("users-desktop-list").className).not.toContain("overflow-x-auto");
    expect(screen.getByTestId("users-desktop-list").innerHTML).not.toContain("min-w-[760px]");
    expect(screen.getByRole("list", { name: "Funcionários" }).className).not.toContain("overflow-x-auto");
  });
});
