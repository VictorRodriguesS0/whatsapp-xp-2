import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionUser } from "@/modules/auth/session";

import { UsersScreen } from "./users-screen";

const routerReplaceMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: routerReplaceMock }) }));

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

describe("UsersScreen", () => {
  beforeEach(() => routerReplaceMock.mockClear());

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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
    expect(screen.getByText("Sua conta atual")).toBeVisible();
  });

  it("moves focus to the first field when opening create and restores it when closing", async () => {
    render(<UsersScreen currentUser={admin} initialUsers={[marcos]} />);
    const trigger = screen.getByRole("button", { name: "Novo usuário" });
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByLabelText("Nome")).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
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
    expect(screen.getByText("Ana Souza")).toBeVisible();
  });

  it("resets a password and reports that previous sessions ended", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ user: marcos }), { status: 200, headers: { "Content-Type": "application/json" } }));
    render(<UsersScreen currentUser={admin} initialUsers={[marcos]} />);

    fireEvent.click(screen.getByRole("button", { name: "Redefinir senha de Marcos" }));
    fireEvent.change(await screen.findByLabelText("Nova senha"), { target: { value: "Nova-senha-2026!" } });
    fireEvent.change(screen.getByLabelText("Confirmar nova senha"), { target: { value: "Nova-senha-2026!" } });
    fireEvent.click(screen.getByRole("button", { name: "Redefinir senha" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/users/user-2/reset-password", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ password: "Nova-senha-2026!" }),
    })));
    expect(await screen.findByRole("status")).toHaveTextContent("As sessões anteriores foram encerradas");
  });

  it("confirms deactivation, blocks duplicate submits and applies the committed response", async () => {
    const pending = deferredResponse();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockReturnValue(pending.promise);
    render(<UsersScreen currentUser={admin} initialUsers={[marcos]} />);

    fireEvent.click(screen.getByRole("button", { name: "Desativar Marcos" }));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: "Desativar usuário" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(confirm).toBeDisabled();
    pending.resolve(new Response(JSON.stringify({ user: { ...marcos, active: false } }), { status: 200, headers: { "Content-Type": "application/json" } }));

    expect(await screen.findByText("Usuário desativado.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Ativar Marcos" })).toBeVisible();
  });

  it("redirects on an expired session without rendering a raw API error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: "GraphAPIError: token abc" }), { status: 401 }));
    render(<UsersScreen currentUser={admin} initialUsers={[marcos]} />);

    fireEvent.click(screen.getByRole("button", { name: "Desativar Marcos" }));
    fireEvent.click((await screen.findByRole("alertdialog")).querySelector("button[type=button][data-confirm]")!);

    await waitFor(() => expect(routerReplaceMock).toHaveBeenCalledWith("/login?motivo=sessao-expirada"));
    expect(screen.queryByText(/GraphAPIError|token abc/)).not.toBeInTheDocument();
  });

  it("maps last-admin conflicts to a safe Portuguese toast", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: "Não é possível desativar o último administrador ativo" }), { status: 409 }));
    render(<UsersScreen currentUser={admin} initialUsers={[{ ...marcos, role: "ADMIN" }]} />);

    fireEvent.click(screen.getByRole("button", { name: "Desativar Marcos" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Desativar usuário" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Mantenha pelo menos um administrador ativo");
  });

  it("maps an edit email conflict without exposing the API body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: "P2002 raw database detail" }), { status: 409 }));
    render(<UsersScreen currentUser={admin} initialUsers={[marcos]} />);

    fireEvent.click(screen.getByRole("button", { name: "Editar Marcos" }));
    fireEvent.change(await screen.findByLabelText("E-mail"), { target: { value: "existente@xp.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));

    expect(await screen.findByText(/e-mail já está em uso/i)).toBeVisible();
    expect(screen.queryByText(/P2002|database detail/)).not.toBeInTheDocument();
  });

  it("rejects a malformed successful response without corrupting the directory", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ user: {} }), { status: 201, headers: { "Content-Type": "application/json" } }));
    render(<UsersScreen currentUser={admin} initialUsers={[marcos]} />);

    fireEvent.click(screen.getByRole("button", { name: "Novo usuário" }));
    fireEvent.change(await screen.findByLabelText("Nome"), { target: { value: "Ana Souza" } });
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "ana@xp.test" } });
    fireEvent.change(screen.getByLabelText("Senha inicial"), { target: { value: "Senha-2026!" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar usuário" }));

    expect(await screen.findByText("Não foi possível criar o usuário.")).toBeVisible();
    expect(screen.getByText("Marcos")).toBeVisible();
    expect(screen.queryByText("Ana Souza")).not.toBeInTheDocument();
  });

  it("keeps mutation responses active through the Strict Mode effect cycle", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ user: { ...marcos, active: false } }), { status: 200, headers: { "Content-Type": "application/json" } }));
    render(<StrictMode><UsersScreen currentUser={admin} initialUsers={[marcos]} /></StrictMode>);

    fireEvent.click(screen.getByRole("button", { name: "Desativar Marcos" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Desativar usuário" }));

    expect(await screen.findByText("Usuário desativado.")).toBeVisible();
  });

  it("lets keyboard users dismiss a non-blocking toast", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: "internal details" }), { status: 500 }));
    render(<UsersScreen currentUser={admin} initialUsers={[marcos]} />);

    fireEvent.click(screen.getByRole("button", { name: "Desativar Marcos" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Desativar usuário" }));
    await screen.findByRole("status");
    fireEvent.click(screen.getByRole("button", { name: "Fechar aviso" }));

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("keeps one mutation in flight so a late response cannot overwrite a newer action", async () => {
    const first = deferredResponse();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockReturnValue(first.promise);
    render(<UsersScreen currentUser={admin} initialUsers={[marcos]} />);

    fireEvent.click(screen.getByRole("button", { name: "Editar Marcos" }));
    fireEvent.change(await screen.findByLabelText("Nome"), { target: { value: "Marcos Lima" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));

    expect(screen.getByRole("button", { name: "Salvando" })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    first.resolve(new Response(JSON.stringify({ user: { ...marcos, name: "Marcos Lima" } }), { status: 200, headers: { "Content-Type": "application/json" } }));
    expect(await screen.findByText("Alterações salvas.")).toBeVisible();
    expect(screen.getByText("Marcos Lima")).toBeVisible();
  });

  it("keeps the current screen and reports when logout cannot reach the server", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));
    render(<UsersScreen currentUser={admin} initialUsers={[marcos]} />);

    fireEvent.click(screen.getByRole("button", { name: "Sair" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Não foi possível sair");
    expect(routerReplaceMock).not.toHaveBeenCalled();
  });
});
