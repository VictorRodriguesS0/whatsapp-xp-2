import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import GlobalError from "./error";
import NotFound from "./not-found";
import UsersError from "./configuracoes/usuarios/error";
import UsersLoading from "./configuracoes/usuarios/loading";

describe("application failure states", () => {
  it("offers retry without exposing internal error details", () => {
    const reset = vi.fn();
    render(<GlobalError error={new Error("Graph raw response with token")} reset={reset} />);
    expect(screen.queryByText(/Graph raw response|token/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(reset).toHaveBeenCalledOnce();
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
  });
});
