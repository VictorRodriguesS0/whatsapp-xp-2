import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { QuickRepliesScreen } from "./quick-replies-screen";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
vi.mock("@/components/theme/theme-menu", () => ({ ThemeMenu: () => <button aria-label="Tema" type="button" /> }));

const reply = { id: "10000000-0000-4000-8000-000000000001", shortcut: "horario", message: "Atendemos das 9h às 17h30.", position: 10, active: true };

describe("quick replies settings screen", () => {
  beforeEach(() => { vi.restoreAllMocks(); replace.mockReset(); });

  it("uses the shared settings shell and responsive modal contract", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/settings/quick-replies-screen.tsx"), "utf8");

    expect(source).toContain("SettingsPageShell");
    expect(source).toContain('className="modal-dialog"');
  });

  it("shows active and inactive shared replies", () => {
    render(<QuickRepliesScreen initialQuickReplies={[reply, { ...reply, id: "2", shortcut: "pix", active: false }]} />);
    expect(screen.getByRole("heading", { name: "Respostas rápidas" })).toBeVisible();
    expect(screen.getByText("/horario")).toBeVisible();
    expect(screen.getByText("Inativa")).toBeVisible();
  });

  it("restores focus to the action that opened the reply dialog", async () => {
    const user = userEvent.setup();
    render(<QuickRepliesScreen initialQuickReplies={[reply]} />);
    const trigger = screen.getByRole("button", { name: "Editar /horario" });

    await user.click(trigger);
    await screen.findByRole("dialog", { name: "Editar resposta rápida" });
    await user.keyboard("{Escape}");

    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("creates a reply from a multiline form", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: reply, error: null }), { status: 201 }));
    render(<QuickRepliesScreen initialQuickReplies={[]} />);
    await user.click(screen.getByRole("button", { name: "Nova resposta" }));
    const dialog = await screen.findByRole("dialog", { name: "Nova resposta rápida" });
    await user.type(within(dialog).getByLabelText("Atalho"), "horario");
    await user.type(within(dialog).getByLabelText("Mensagem"), "Atendemos das 9h às 17h30.");
    await user.click(within(dialog).getByRole("button", { name: "Criar resposta" }));
    await waitFor(() => expect(screen.getByText("/horario")).toBeVisible());
    expect(fetch).toHaveBeenCalledWith("/api/quick-replies", expect.objectContaining({ method: "POST" }));
  });

  it("edits and deactivates a reply with safe feedback", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { ...reply, message: "Novo texto" }, error: null })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { ...reply, message: "Novo texto", active: false }, error: null })));
    render(<QuickRepliesScreen initialQuickReplies={[reply]} />);
    await user.click(screen.getByRole("button", { name: "Editar /horario" }));
    const dialog = await screen.findByRole("dialog", { name: "Editar resposta rápida" });
    fireEvent.change(within(dialog).getByLabelText("Mensagem"), { target: { value: "Novo texto" } });
    await user.click(within(dialog).getByRole("button", { name: "Salvar alterações" }));
    await user.click(await screen.findByRole("button", { name: "Desativar /horario" }));
    await waitFor(() => expect(screen.getByText("Inativa")).toBeVisible());
    expect(fetchMock).toHaveBeenLastCalledWith(`/api/quick-replies/${reply.id}`, expect.objectContaining({ method: "PATCH" }));
  });

  it("shows duplicate errors and redirects an expired session", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: null, error: { code: "CONFLICT", message: "Atalho já cadastrado" } }), { status: 409 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    render(<QuickRepliesScreen initialQuickReplies={[reply]} />);
    await user.click(screen.getByRole("button", { name: "Nova resposta" }));
    const dialog = await screen.findByRole("dialog", { name: "Nova resposta rápida" });
    await user.type(within(dialog).getByLabelText("Atalho"), "horario");
    await user.type(within(dialog).getByLabelText("Mensagem"), "Duplicada");
    await user.click(within(dialog).getByRole("button", { name: "Criar resposta" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Atalho já cadastrado");
    await user.click(screen.getByRole("button", { name: "Fechar" }));
    await user.click(screen.getByRole("button", { name: "Desativar /horario" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login?motivo=sessao-expirada"));
  });
});
