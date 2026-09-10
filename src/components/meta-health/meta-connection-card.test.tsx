import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MetaConnectionCard } from "./meta-connection-card";
import { launchEmbeddedSignup, loadEmbeddedSignupSdk } from "@/modules/meta-connection/embedded-signup";

vi.mock("@/modules/meta-connection/embedded-signup", () => ({ loadEmbeddedSignupSdk: vi.fn(async () => ({})), launchEmbeddedSignup: vi.fn(() => vi.fn()) }));
const config = { enabled: true, reason: null, appId: "100", configId: "200", sdkVersion: "v26.0" };
const connection = { state: "DISCONNECTED" as const, observedAt: "2026-09-10T12:00:00Z", reason: "ACCOUNT_OFFBOARDED", stale: false };
const attempt = { id: "10000000-0000-4000-8000-000000000001", state: "WAITING", expiresAt: new Date(Date.now() + 900_000).toISOString(), errorCode: null };

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe("Meta connection card", () => {
  it("shows a confirmed outage even when signup is not configured", () => {
    render(<MetaConnectionCard connection={connection} config={{ ...config, enabled: false, reason: "Configuração pendente na Meta." }} phoneNumber="+55 11 99999-0000" onRefresh={vi.fn()} />);
    expect(screen.getByText("Desconectado")).toBeVisible();
    expect(screen.getByRole("button", { name: "Reconectar WhatsApp" })).toBeDisabled();
    expect(screen.getByText("Configuração pendente na Meta.")).toBeVisible();
    expect(loadEmbeddedSignupSdk).not.toHaveBeenCalled();
  });

  it("explains companion unlinking before opening the official popup", async () => {
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => Response.json(init?.method === "POST" ? { attempt: { ...attempt, nonce: "n".repeat(43) } } : { config, attempt: null }));
    vi.stubGlobal("fetch", fetcher);
    render(<MetaConnectionCard connection={connection} config={config} phoneNumber="+55 11 99999-0000" onRefresh={vi.fn()} />);
    await waitFor(() => expect(fetcher).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Reconectar WhatsApp" }));
    expect(await screen.findByText(/desconecta os aparelhos adicionais/)).toBeVisible();
    expect(launchEmbeddedSignup).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Continuar na Meta" }));
    expect(launchEmbeddedSignup).toHaveBeenCalledTimes(1);
  });

  it("posts the code immediately and waits for backend confirmation", async () => {
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (!init?.body) return Response.json({ config, attempt: null });
      const body = JSON.parse(String(init.body));
      return Response.json({ attempt: body.action === "start" ? { ...attempt, nonce: "n".repeat(43) } : { ...attempt, state: "VERIFYING" } });
    });
    vi.stubGlobal("fetch", fetcher);
    render(<MetaConnectionCard connection={connection} config={config} phoneNumber={null} onRefresh={vi.fn()} />);
    await waitFor(() => expect(fetcher).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Reconectar WhatsApp" }));
    fireEvent.click(await screen.findByRole("button", { name: "Continuar na Meta" }));
    const callbacks = vi.mocked(launchEmbeddedSignup).mock.calls[0][2];
    await act(async () => { callbacks.onCode("one-use-code"); });
    expect(fetcher.mock.calls.some(([, init]) => init?.body && JSON.parse(String(init.body)).action === "exchange")).toBe(true);
    expect(screen.getByText("Desconectado")).toBeVisible();
    expect(screen.getByText("Confirmando conexão na Meta…")).toBeVisible();
  });
});
