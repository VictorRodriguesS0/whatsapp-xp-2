import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import GlobalError from "./error";
import NotFound from "./not-found";
import UsersError from "./configuracoes/usuarios/error";
import UsersLoading from "./configuracoes/usuarios/loading";
import ClassificationError from "./configuracoes/atendimento/error";
import ClassificationLoading from "./configuracoes/atendimento/loading";
import MetaHealthError from "./configuracoes/meta/error";
import MetaHealthLoading from "./configuracoes/meta/loading";
import CatalogSettingsError from "./configuracoes/catalogo/error";
import CatalogSettingsLoading from "./configuracoes/catalogo/loading";
import QuickRepliesError from "./configuracoes/respostas-rapidas/error";
import QuickRepliesLoading from "./configuracoes/respostas-rapidas/loading";

vi.mock("@/components/theme/theme-menu", () => ({ ThemeMenu: () => <button aria-label="Tema" type="button" /> }));

describe("application failure states", () => {
  it("offers retry without exposing internal error details", () => {
    const reset = vi.fn();
    render(<GlobalError error={new Error("Graph raw response with token")} reset={reset} />);
    expect(screen.queryByText(/Graph raw response|token/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(reset).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("XP Eletrônicos")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tema" })).toBeVisible();
  });

  it("uses a route-specific retry action", () => {
    const reset = vi.fn();
    render(<UsersError error={new Error("database stack")} reset={reset} />);
    expect(screen.getByRole("heading", { name: "Não foi possível carregar os usuários" })).toBeVisible();
    expect(screen.queryByText(/database stack/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it("has accessible loading and not-found navigation", () => {
    const { rerender } = render(<UsersLoading />);
    expect(screen.getByRole("status")).toHaveTextContent("Carregando usuários");
    rerender(<NotFound />);
    expect(screen.getByRole("heading", { name: "Página não encontrada" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Voltar para conversas" })).toHaveAttribute("href", "/conversas");
    expect(screen.getByLabelText("XP Eletrônicos")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tema" })).toBeVisible();
  });

  it.each([
    ["usuários", UsersLoading, "Carregando usuários"],
    ["classificações", ClassificationLoading, "Carregando classificações"],
    ["saúde da Meta", MetaHealthLoading, "Carregando saúde da Meta"],
    ["catálogo", CatalogSettingsLoading, "Carregando catálogo do WhatsApp"],
    ["respostas rápidas", QuickRepliesLoading, "Carregando respostas rápidas"],
  ])("keeps the %s loading state named and inside the branded settings shell", (_name, Component, label) => {
    render(<Component />);

    expect(screen.getByRole("status")).toHaveTextContent(label);
    expect(screen.getByLabelText("XP Eletrônicos")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tema" })).toBeVisible();
  });

  it.each([
    ["usuários", UsersError, "Não foi possível carregar os usuários"],
    ["classificações", ClassificationError, "Não foi possível carregar as classificações"],
    ["saúde da Meta", MetaHealthError, "Não foi possível carregar a saúde da Meta"],
    ["catálogo", CatalogSettingsError, "Não foi possível carregar o catálogo"],
    ["respostas rápidas", QuickRepliesError, "Não foi possível carregar as respostas rápidas"],
  ])("keeps the %s route error safe, branded and retryable", (_name, Component, heading) => {
    const reset = vi.fn();
    render(<Component error={new Error("private stack token")} reset={reset} />);

    expect(screen.getByRole("heading", { name: heading })).toBeVisible();
    expect(document.body).not.toHaveTextContent("private stack token");
    expect(screen.getByLabelText("XP Eletrônicos")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it("removes the old hard-coded top-border error treatment", () => {
    for (const file of [
      "src/app/error.tsx",
      "src/app/not-found.tsx",
      "src/app/configuracoes/usuarios/error.tsx",
      "src/app/configuracoes/atendimento/error.tsx",
    ]) {
      expect(readFileSync(resolve(process.cwd(), file), "utf8")).not.toContain("border-t-4");
    }
  });
});
