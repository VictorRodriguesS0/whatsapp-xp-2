import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LoginForm } from "./login-form";

describe("LoginForm", () => {
  afterEach(() => vi.restoreAllMocks());

  async function submit() {
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "marcos@xp.test" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "senha-inválida" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
  }

  it("does not reveal whether an email exists after invalid credentials", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 401 } as Response);
    render(<LoginForm />);
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("E-mail ou senha inválidos");
  });

  it("distinguishes rate limiting from a network failure", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({ ok: false, status: 429 } as Response).mockRejectedValueOnce(new TypeError("offline"));
    const { rerender } = render(<LoginForm />);
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Muitas tentativas");

    rerender(<LoginForm />);
    await submit();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Sem conexão"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("provides visible labels and browser autocomplete hints", () => {
    render(<LoginForm />);
    expect(screen.getByLabelText("E-mail")).toHaveAttribute("autocomplete", "email");
    expect(screen.getByLabelText("Senha")).toHaveAttribute("autocomplete", "current-password");
  });

  it("focuses a safe error summary and preserves the typed email", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 401 } as Response);
    render(<LoginForm />);

    const email = screen.getByLabelText("E-mail");
    fireEvent.change(email, { target: { value: "marcos@xp.test" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "senha-inválida" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveFocus());
    expect(email).toHaveValue("marcos@xp.test");
    expect(fetch).toHaveBeenCalledWith("/api/auth/login", expect.objectContaining({
      body: JSON.stringify({ email: "marcos@xp.test", password: "senha-inválida" }),
    }));
  });
});
