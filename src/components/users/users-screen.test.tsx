import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionUser } from "@/modules/auth/session";

import { UsersScreen } from "./users-screen";

const routerReplaceMock = vi.hoisted(() => vi.fn());
const routerRefreshMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: routerRefreshMock, replace: routerReplaceMock }) }));
vi.mock("@/components/theme/theme-menu", () => ({ ThemeMenu: () => <button aria-label="Tema" type="button" /> }));

const admin: SessionUser = { id: "admin-1", name: "Victor", email: "victor@xp.test", role: "ADMIN" };
const marcos = {
  id: "user-2",
  name: "Marcos",
  email: "marcos@xp.test",
  role: "ATTENDANT" as const,
  active: true,
  createdAt: new Date("2026-08-20T10:00:00Z"),
  updatedAt: new Date("2026-08-20T10:00:00Z"),
};

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}

function desktopDirectory() {
  return within(screen.getByTestId("users-desktop-list"));
}

function desktopAction(name: string) {
  return desktopDirectory().getByRole("button", { name });
}

describe("UsersScreen", () => {
  beforeEach(() => {
    routerReplaceMock.mockClear();
    routerRefreshMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("delegates the directory to the responsive list without the old horizontal-table contract", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/users/users-screen.tsx"), "utf8");

    expect(source).toContain("ResponsiveSettingsList");
    expect(source).not.toContain("overflow-x-auto");
    expect(source).not.toContain("min-w-[760px]");
  });

  it("uses the shared settings shell and responsive modal contract", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/users/users-screen.tsx"), "utf8");

    expect(source).toContain("SettingsPageShell");
    expect(source).toContain('className="modal-dialog"');
  });

  it("lists identity, profile and status, offers deactivation and never delete", () => {
    render(<UsersScreen currentUser={admin} initialUsers={[marcos]} />);

    const row = screen.getByRole("row", { name: /Marcos/i });
    expect(within(row).getByText("marcos@xp.test")).toBeVisible();
    expect(within(row).getByText("Atendente")).toBeVisible();
    expect(within(row).getByText("Ativo")).toBeVisible();
    expect(within(row).getByRole("button", { name: "Desativar Marcos" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /excluir/i })).not.toBeInTheDocument();
  });

  it("does not let the signed-in administrator deactivate their own account", () => {
    render(<UsersScreen currentUser={admin} initialUsers={[{ ...marcos, id: admin.id, name: admin.name, email: admin.email, role: "ADMIN" }]} />);
    expect(screen.queryByRole("button", { name: /Desativar Victor/ })).not.toBeInTheDocument();
    expect(screen.getAllByText("Sua conta atual")).toHaveLength(2);
  });

  it("moves focus to the first field when opening create and restores it when closing", async () => {
    render(<UsersScreen currentUser={admin} initialUsers={[marcos]} />);
    const trigger = screen.getByRole("button", { name: "Novo usuário" });
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByLabelText("Nome")).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("restores each state-driven dialog trigger after keyboard and close-button dismissal", async () => {
    const user = userEvent.setup();
    render(<UsersScreen currentUser={admin} initialUsers={[marcos]} />);

    const editTrigger = desktopAction("Editar Marcos");
    editTrigger.focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("dialog", { name: "Editar usuário" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(editTrigger).toHaveFocus());

    const resetTrigger = desktopAction("Redefinir senha de Marcos");
    await user.click(resetTrigger);
    await user.click(await screen.findByRole("button", { name: "Fechar" }));
    await waitFor(() => expect(resetTrigger).toHaveFocus());
  });

  it("restores focus to the equivalent visible action after crossing the responsive breakpoint", async () => {
    const user = userEvent.setup();
    render(<UsersScreen currentUser={admin} initialUsers={[marcos]} />);
    const desktopTrigger = desktopAction("Editar Marcos");
    const mobileTrigger = within(screen.getByRole("list", { name: "Funcionários" })).getByRole("button", { name: "Editar Marcos" });

    await user.click(desktopTrigger);
    await screen.findByRole("dialog", { name: "Editar usuário" });
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
    await user.keyboard("{Escape}");

    await waitFor(() => expect(mobileTrigger).toHaveFocus());
  });

  it("restores the access trigger after Cancelar and after a successful confirmation", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ user: { ...marcos, active: false } }), { status: 200, headers: { "Content-Type": "application/json" } }));
    render(<UsersScreen currentUser={admin} initialUsers={[marcos]} />);

    const trigger = desktopAction("Desativar Marcos");
    trigger.focus();
    await user.keyboard("{Enter}");
    const cancel = within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancelar" });
    cancel.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(trigger).toHaveFocus());

    await user.keyboard("{Enter}");
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Desativar usuário" }));
    await waitFor(() => expect(trigger).toHaveFocus());

    const activateTrigger = desktopAction("Ativar Marcos");
    await user.keyboard("{Enter}");
    const activateCancel = within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancelar" });
    activateCancel.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(activateTrigger).toHaveFocus());
  });

  it("restores the access trigger when an error is dismissed with Escape", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));
    render(<UsersScreen currentUser={admin} initialUsers={[marcos]} />);

    const trigger = desktopAction("Desativar Marcos");
    await user.click(trigger);
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Desativar usuário" }));
    await screen.findByRole("status");
    await user.keyboard("{Escape}");

    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("creates a user with the validated form values", async () => {
    const created = { ...marcos, id: "user-3", name: "Ana Souza", email: "ana@xp.test" };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ user: created }), { status: 201, headers: { "Content-Type": "application/json" } }));
    render(<UsersScreen currentUser={admin} initialUsers={[marcos]} />);

    fireEvent.click(screen.getByRole("button", { name: "Novo usuário" }));
    fireEvent.change(await screen.findByLabelText("Nome"), { target: { value: "Ana Souza" } });
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "ANA@XP.TEST" } });
    fireEvent.change(screen.getByLabelText("Senha inicial"), { target: { value: "Senha-2026!" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar usuário" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/users", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ name: "Ana Souza", email: "ana@xp.test", role: "ATTENDANT", password: "Senha-2026!" }),
    })));
    expect(await screen.findByText("Usuário criado.")).toBeVisible();
    expect(desktopDirectory().getByText("Ana Souza")).toBeVisible();
  });

  it("resets a password and reports that previous sessions ended", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ user: marcos }), { status: 200, headers: { "Content-Type": "application/json" } }));
    render(<UsersScreen currentUser={admin} initialUsers={[marcos]} />);

    const trigger = desktopAction("Redefinir senha de Marcos");
    fireEvent.click(trigger);
    fireEvent.change(await screen.findByLabelText("Nova senha"), { target: { value: "Nova-senha-2026!" } });
    fireEvent.change(screen.getByLabelText("Confirmar nova senha"), { target: { value: "Nova-senha-2026!" } });
    fireEvent.click(screen.getByRole("button", { name: "Redefinir senha" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/users/user-2/reset-password", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ password: "Nova-senha-2026!" }),
    })));
    expect(await screen.findByRole("status")).toHaveTextContent("As sessões anteriores foram encerradas");
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("confirms deactivation, blocks duplicate submits and applies the committed response", async () => {
    const pending = deferredResponse();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockReturnValue(pending.promise);
    render(<UsersScreen currentUser={admin} initialUsers={[marcos]} />);

    fireEvent.click(desktopAction("Desativar Marcos"));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: "Desativar usuário" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(confirm).toBeDisabled();
    pending.resolve(new Response(JSON.stringify({ user: { ...marcos, active: false } }), { status: 200, headers: { "Content-Type": "application/json" } }));

    expect(await screen.findByText("Usuário desativado.")).toBeVisible();
    expect(desktopAction("Ativar Marcos")).toBeVisible();
  });

  it("redirects on an expired session without rendering a raw API error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: "GraphAPIError: token abc" }), { status: 401 }));
    render(<UsersScreen currentUser={admin} initialUsers={[marcos]} />);

    fireEvent.click(desktopAction("Desativar Marcos"));
    fireEvent.click((await screen.findByRole("alertdialog")).querySelector("button[type=button][data-confirm]")!);

    await waitFor(() => expect(routerReplaceMock).toHaveBeenCalledWith("/login?motivo=sessao-expirada"));
    expect(screen.queryByText(/GraphAPIError|token abc/)).not.toBeInTheDocument();
  });

  it("maps last-admin conflicts to a safe Portuguese toast", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: "Não é possível desativar o último administrador ativo" }), { status: 409 }));
    render(<UsersScreen currentUser={admin} initialUsers={[{ ...marcos, role: "ADMIN" }]} />);

    fireEvent.click(desktopAction("Desativar Marcos"));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Desativar usuário" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Mantenha pelo menos um administrador ativo");
  });

  it("maps an edit email conflict without exposing the API body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: "P2002 raw database detail" }), { status: 409 }));
    render(<UsersScreen currentUser={admin} initialUsers={[marcos]} />);

    const trigger = desktopAction("Editar Marcos");
    fireEvent.click(trigger);
    fireEvent.change(await screen.findByLabelText("E-mail"), { target: { value: "existente@xp.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));

    expect(await screen.findByText(/e-mail já está em uso/i)).toBeVisible();
    expect(screen.queryByText(/P2002|database detail/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("patches only the changed edit field so stale modal values cannot clobber newer data", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ user: { ...marcos, name: "Marcos Lima" } }), { status: 200, headers: { "Content-Type": "application/json" } }));
    render(<UsersScreen currentUser={admin} initialUsers={[marcos]} />);

    const trigger = desktopAction("Editar Marcos");
    fireEvent.click(trigger);
    fireEvent.change(await screen.findByLabelText("Nome"), { target: { value: "Marcos Lima" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/users/user-2", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ name: "Marcos Lima" }),
    })));
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("leaves the admin screen after the signed-in user becomes an attendant", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ user: { ...marcos, id: admin.id, email: admin.email, role: "ATTENDANT" } }), { status: 200, headers: { "Content-Type": "application/json" } }));
    render(<UsersScreen currentUser={admin} initialUsers={[{ ...marcos, id: admin.id, name: admin.name, email: admin.email, role: "ADMIN" }]} />);

    fireEvent.click(desktopAction("Editar Victor"));
    fireEvent.change(await screen.findByLabelText("Nome"), { target: { value: "Victor Silva" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));

    await waitFor(() => expect(routerReplaceMock).toHaveBeenCalledWith("/conversas"));
    expect(routerRefreshMock).toHaveBeenCalledTimes(1);
  });

  it("returns to login after resetting the signed-in user's own password", async () => {
    const ownUser = { ...marcos, id: admin.id, name: admin.name, email: admin.email, role: "ADMIN" as const };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ user: ownUser }), { status: 200, headers: { "Content-Type": "application/json" } }));
    render(<UsersScreen currentUser={admin} initialUsers={[ownUser]} />);

    fireEvent.click(desktopAction("Redefinir senha de Victor"));
    fireEvent.change(await screen.findByLabelText("Nova senha"), { target: { value: "Nova-senha-2026!" } });
    fireEvent.change(screen.getByLabelText("Confirmar nova senha"), { target: { value: "Nova-senha-2026!" } });
    fireEvent.click(screen.getByRole("button", { name: "Redefinir senha" }));

    await waitFor(() => expect(routerReplaceMock).toHaveBeenCalledWith("/login"));
    expect(routerRefreshMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Senha redefinida. As sessões anteriores foram encerradas.")).not.toBeInTheDocument();
  });

  it("rejects a malformed successful response without corrupting the directory", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ user: {} }), { status: 201, headers: { "Content-Type": "application/json" } }));
    render(<UsersScreen currentUser={admin} initialUsers={[marcos]} />);

    fireEvent.click(screen.getByRole("button", { name: "Novo usuário" }));
    fireEvent.change(await screen.findByLabelText("Nome"), { target: { value: "Ana Souza" } });
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "ana@xp.test" } });
    fireEvent.change(screen.getByLabelText("Senha inicial"), { target: { value: "Senha-2026!" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar usuário" }));

    expect(await screen.findByText("Resposta inesperada do servidor. Tente novamente.")).toBeVisible();
    expect(desktopDirectory().getByText("Marcos")).toBeVisible();
    expect(screen.queryByText("Ana Souza")).not.toBeInTheDocument();
  });

  it("distinguishes a rejected request from a non-JSON server response without exposing raw data", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("secret network detail"))
      .mockResolvedValueOnce(new Response("GraphAPI raw response", { status: 200 }));
    render(<UsersScreen currentUser={admin} initialUsers={[marcos]} />);

    fireEvent.click(desktopAction("Desativar Marcos"));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Desativar usuário" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Sem conexão. Confira sua rede e tente novamente.");
    expect(screen.queryByText(/secret network detail/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Fechar aviso" }));
    fireEvent.click(desktopAction("Desativar Marcos"));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Desativar usuário" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Resposta inesperada do servidor. Tente novamente.");
    expect(screen.queryByText(/GraphAPI raw response/i)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps mutation responses active through the Strict Mode effect cycle", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ user: { ...marcos, active: false } }), { status: 200, headers: { "Content-Type": "application/json" } }));
    render(<StrictMode><UsersScreen currentUser={admin} initialUsers={[marcos]} /></StrictMode>);

    fireEvent.click(desktopAction("Desativar Marcos"));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Desativar usuário" }));

    expect(await screen.findByText("Usuário desativado.")).toBeVisible();
  });

  it("lets keyboard users dismiss a non-blocking toast", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: "internal details" }), { status: 500 }));
    render(<UsersScreen currentUser={admin} initialUsers={[marcos]} />);

    fireEvent.click(desktopAction("Desativar Marcos"));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Desativar usuário" }));
    await screen.findByRole("status");
    fireEvent.click(screen.getByRole("button", { name: "Fechar aviso" }));

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("keeps one mutation in flight so a late response cannot overwrite a newer action", async () => {
    const first = deferredResponse();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockReturnValue(first.promise);
    render(<UsersScreen currentUser={admin} initialUsers={[marcos]} />);

    fireEvent.click(desktopAction("Editar Marcos"));
    fireEvent.change(await screen.findByLabelText("Nome"), { target: { value: "Marcos Lima" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));

    expect(screen.getByRole("button", { name: "Salvando" })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    first.resolve(new Response(JSON.stringify({ user: { ...marcos, name: "Marcos Lima" } }), { status: 200, headers: { "Content-Type": "application/json" } }));
    expect(await screen.findByText("Alterações salvas.")).toBeVisible();
    expect(desktopDirectory().getByText("Marcos Lima")).toBeVisible();
  });

  it("keeps the current screen and reports when logout cannot reach the server", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));
    render(<UsersScreen currentUser={admin} initialUsers={[marcos]} />);

    fireEvent.click(screen.getByRole("button", { name: "Sair" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Não foi possível sair");
    expect(routerReplaceMock).not.toHaveBeenCalled();
  });
});
