import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ContactClassificationScreen, type ContactDefinition } from "./contact-classification-screen";

const routerReplaceMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: routerReplaceMock }) }));
vi.mock("@/components/theme/theme-menu", () => ({ ThemeMenu: () => <button aria-label="Tema" type="button" /> }));

const lead: ContactDefinition = {
  id: "type-2",
  displayName: "Lead",
  color: "#176B52",
  position: 20,
  active: true,
};

const customer: ContactDefinition = {
  id: "type-1",
  displayName: "Cliente",
  color: "#2458A6",
  position: 10,
  active: false,
};

const priority: ContactDefinition = {
  id: "tag-1",
  displayName: "Prioridade",
  color: "#B4443C",
  position: 0,
  active: true,
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("ContactClassificationScreen", () => {
  beforeEach(() => routerReplaceMock.mockClear());

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses the shared settings shell and responsive modal contract", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/settings/contact-classification-screen.tsx"), "utf8");

    expect(source).toContain("SettingsPageShell");
    expect(source).toContain('className="modal-dialog"');
  });

  it("orders compact sections by position and id while exposing status and color as text", () => {
    render(<ContactClassificationScreen initialContactTags={[priority]} initialContactTypes={[lead, customer]} />);

    const types = screen.getByRole("region", { name: "Tipos de contato" });
    const rows = within(types).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Cliente");
    expect(rows[0]).toHaveTextContent("Inativo");
    expect(rows[0]).toHaveTextContent("#2458A6");
    expect(rows[1]).toHaveTextContent("Lead");
    expect(within(screen.getByRole("region", { name: "Etiquetas" })).getByText("Prioridade")).toBeVisible();
    expect(screen.queryByRole("button", { name: /excluir/i })).not.toBeInTheDocument();
  });

  it("never renders an invalid server color as CSS and keeps a textual fallback", () => {
    render(<ContactClassificationScreen initialContactTags={[]} initialContactTypes={[{ ...lead, color: "url(javascript:bad)" }]} />);

    expect(screen.getByText(/Cor indisponível/)).toBeVisible();
    expect(screen.queryByTestId("color-swatch")).not.toBeInTheDocument();
  });

  it("shows concise empty states independently for each definition kind", () => {
    render(<ContactClassificationScreen initialContactTags={[]} initialContactTypes={[]} />);

    expect(screen.getByText("Nenhum tipo de contato cadastrado.")).toBeVisible();
    expect(screen.getByText("Nenhuma etiqueta cadastrada.")).toBeVisible();
  });

  it("opens an accessible create dialog, labels the textual color value and restores trigger focus", async () => {
    const user = userEvent.setup();
    render(<ContactClassificationScreen initialContactTags={[]} initialContactTypes={[]} />);
    const trigger = screen.getByRole("button", { name: "Novo tipo" });

    await user.click(trigger);
    expect(await screen.findByRole("dialog", { name: "Novo tipo de contato" })).toBeVisible();
    expect(screen.getByLabelText("Nome")).toHaveFocus();
    expect(screen.getByLabelText("Cor hexadecimal")).toHaveValue("#176B52");
    expect(screen.getByText("Valor da cor: #176B52")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("creates once and refetches the authoritative ordered collection before closing", async () => {
    const pending = deferredResponse();
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(jsonResponse({ data: { items: [customer, lead] }, error: null }));
    render(<ContactClassificationScreen initialContactTags={[]} initialContactTypes={[lead]} />);

    fireEvent.click(screen.getByRole("button", { name: "Novo tipo" }));
    fireEvent.change(await screen.findByLabelText("Nome"), { target: { value: "Cliente" } });
    fireEvent.change(screen.getByLabelText("Cor hexadecimal"), { target: { value: "#2458a6" } });
    fireEvent.change(screen.getByLabelText("Posição"), { target: { value: "10" } });
    const submit = screen.getByRole("button", { name: "Criar tipo" });
    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/settings/contact-types", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ displayName: "Cliente", color: "#2458A6", position: 10 }),
    }));
    expect(submit).toBeDisabled();

    pending.resolve(jsonResponse({ data: customer, error: null }, 201));
    await waitFor(() => expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/settings/contact-types", expect.objectContaining({ cache: "no-store", method: "GET" })));
    expect(await screen.findByText("Tipo criado.")).toBeVisible();
    expect(screen.getByText("Cliente")).toBeVisible();
    expect(screen.queryByRole("dialog", { name: "Novo tipo de contato" })).not.toBeInTheDocument();
  });

  it("does not repeat a confirmed create when the authoritative refetch fails", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: customer, error: null }, 201))
      .mockRejectedValueOnce(new Error("offline"));
    render(<ContactClassificationScreen initialContactTags={[]} initialContactTypes={[lead]} />);

    fireEvent.click(screen.getByRole("button", { name: "Novo tipo" }));
    fireEvent.change(await screen.findByLabelText("Nome"), { target: { value: "Cliente" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar tipo" }));

    expect(await screen.findByText("Tipo criado, mas a lista não pôde ser atualizada. Atualize a página para conferir.")).toBeVisible();
    expect(screen.queryByRole("dialog", { name: "Novo tipo de contato" })).not.toBeInTheDocument();
    expect(screen.getByText("Lead")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Novo tipo" }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("edits only changed values, then uses refetched data instead of the mutation snapshot", async () => {
    const authoritative = { ...lead, displayName: "Lead novo", position: 5 };
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: { ...lead, displayName: "resposta obsoleta" }, error: null }))
      .mockResolvedValueOnce(jsonResponse({ data: { items: [authoritative] }, error: null }));
    render(<ContactClassificationScreen initialContactTags={[]} initialContactTypes={[lead]} />);

    const trigger = screen.getByRole("button", { name: "Editar Lead" });
    fireEvent.click(trigger);
    fireEvent.change(await screen.findByLabelText("Nome"), { target: { value: "Lead novo" } });
    fireEvent.change(screen.getByLabelText("Posição"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));

    await waitFor(() => expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/settings/contact-types/type-2", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ displayName: "Lead novo", position: 5 }),
    })));
    expect(await screen.findByText("Alterações salvas.")).toBeVisible();
    expect(screen.getByText("Lead novo")).toBeVisible();
    expect(screen.queryByText("resposta obsoleta")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("deactivates without delete and refetches the authoritative tag collection", async () => {
    const inactive = { ...priority, active: false };
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: inactive, error: null }))
      .mockResolvedValueOnce(jsonResponse({ data: { items: [inactive] }, error: null }));
    render(<ContactClassificationScreen initialContactTags={[priority]} initialContactTypes={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "Desativar Prioridade" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Desativar etiqueta" }));

    await waitFor(() => expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/settings/contact-tags/tag-1", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ active: false }),
    })));
    expect(await screen.findByText("Etiqueta desativada.")).toBeVisible();
    expect(within(screen.getByRole("region", { name: "Etiquetas" })).getByText("Inativo")).toBeVisible();
    await waitFor(() => expect(screen.getByRole("button", { name: "Nova etiqueta" })).toHaveFocus());
  });

  it("maps duplicate conflicts safely and lets Escape restore the current dialog trigger", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: null, error: { code: "CONFLICT", message: "P2002 database detail" } }, 409));
    render(<ContactClassificationScreen initialContactTags={[]} initialContactTypes={[]} />);
    const trigger = screen.getByRole("button", { name: "Nova etiqueta" });

    await user.click(trigger);
    fireEvent.change(await screen.findByLabelText("Nome"), { target: { value: "Prioridade" } });
    await user.click(screen.getByRole("button", { name: "Criar etiqueta" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Já existe uma etiqueta com esse nome");
    expect(screen.queryByText(/P2002|database detail/)).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("clears a dialog-scoped error before opening a different definition flow", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: null, error: { code: "CONFLICT", message: "raw" } }, 409));
    render(<ContactClassificationScreen initialContactTags={[]} initialContactTypes={[]} />);

    await user.click(screen.getByRole("button", { name: "Novo tipo" }));
    fireEvent.change(await screen.findByLabelText("Nome"), { target: { value: "Cliente" } });
    await user.click(screen.getByRole("button", { name: "Criar tipo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Já existe um tipo de contato");
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("button", { name: "Nova etiqueta" }));
    expect(await screen.findByRole("dialog", { name: "Nova etiqueta" })).toBeVisible();
    expect(screen.queryByText("Já existe um tipo de contato com esse nome.")).not.toBeInTheDocument();
  });

  it("does not leak a dialog-scoped error into the global notice after closing", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: null, error: { code: "CONFLICT", message: "raw" } }, 409));
    render(<ContactClassificationScreen initialContactTags={[]} initialContactTypes={[]} />);

    await user.click(screen.getByRole("button", { name: "Novo tipo" }));
    fireEvent.change(await screen.findByLabelText("Nome"), { target: { value: "Cliente" } });
    await user.click(screen.getByRole("button", { name: "Criar tipo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Já existe um tipo de contato");

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByText("Já existe um tipo de contato com esse nome.")).not.toBeInTheDocument());
  });

  it.each([
    ["network", () => Promise.reject(new Error("offline")), "Sem conexão. Confira sua rede e tente novamente."],
    ["malformed", () => Promise.resolve(jsonResponse({ data: { items: [{}] }, error: null })), "Resposta inesperada do servidor. Tente novamente."],
  ])("keeps %s failures safe and does not overwrite the current collection", async (_case, implementation, message) => {
    vi.spyOn(globalThis, "fetch").mockImplementation(implementation);
    render(<ContactClassificationScreen initialContactTags={[]} initialContactTypes={[lead]} />);

    fireEvent.click(screen.getByRole("button", { name: "Novo tipo" }));
    fireEvent.change(await screen.findByLabelText("Nome"), { target: { value: "Cliente" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar tipo" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByText("Lead")).toBeVisible();
  });

  it("dismisses keyboard-accessible notices and redirects an expired session without raw details", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: null, error: { code: "UNAUTHORIZED", message: "provider token" } }, 401));
    render(<ContactClassificationScreen initialContactTags={[]} initialContactTypes={[]} />);

    await user.click(screen.getByRole("button", { name: "Novo tipo" }));
    fireEvent.change(await screen.findByLabelText("Nome"), { target: { value: "Cliente" } });
    await user.click(screen.getByRole("button", { name: "Criar tipo" }));

    await waitFor(() => expect(routerReplaceMock).toHaveBeenCalledWith("/login?motivo=sessao-expirada"));
    expect(screen.queryByText(/provider token/)).not.toBeInTheDocument();
  });
});
