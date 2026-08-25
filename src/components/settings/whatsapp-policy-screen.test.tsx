import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WhatsAppPolicySettingsDto } from "@/modules/templates/types";

import { WhatsAppPolicyScreen } from "./whatsapp-policy-screen";

const routerReplaceMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplaceMock }),
}));

const approvedTemplate = {
  id: "10000000-0000-4000-8000-000000000001",
  name: "retomar_atendimento",
  language: "pt_BR",
  category: "UTILITY",
  status: "APPROVED",
  qualityScore: "GREEN",
  supported: true,
  bodyText: "Olá, {{1}}! Podemos continuar por aqui?",
  parameterCount: 1,
  syncedAt: "2026-08-24T12:00:00.000Z",
  assigned: false,
};

function settings(
  overrides: Partial<WhatsAppPolicySettingsDto> = {},
): WhatsAppPolicySettingsDto {
  return {
    mode: "INACTIVE",
    version: 0,
    lastSync: {
      status: "SUCCEEDED",
      attemptedAt: "2026-08-24T12:00:00.000Z",
      succeededAt: "2026-08-24T12:00:00.000Z",
      failureCode: null,
    },
    templates: [
      approvedTemplate,
      {
        ...approvedTemplate,
        id: "10000000-0000-4000-8000-000000000002",
        name: "modelo_com_cabecalho",
        supported: false,
        status: "APPROVED",
      },
      {
        ...approvedTemplate,
        id: "10000000-0000-4000-8000-000000000003",
        name: "modelo_pendente",
        status: "PENDING",
      },
    ],
    assignment: null,
    canActivate: false,
    readinessReason: "NO_ASSIGNMENT",
    ...overrides,
  };
}

function envelope(data: WhatsAppPolicySettingsDto) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ data, error: null }),
  } as Response;
}

describe("WhatsAppPolicyScreen", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    routerReplaceMock.mockResolvedValue(undefined);
  });

  it("shows the four operational states, eligible rows and exact preview", () => {
    render(<WhatsAppPolicyScreen initialSettings={settings()} />);

    expect(screen.getByText("Proteção da janela")).toBeVisible();
    expect(screen.getByText("Última sincronização")).toBeVisible();
    expect(screen.getByText("Modelo de retomada")).toBeVisible();
    expect(screen.getByText("Prontidão")).toBeVisible();
    expect(screen.getByText("Proteção desativada")).toBeVisible();
    expect(
      screen.getByRole("radio", { name: /retomar_atendimento/i }),
    ).toBeEnabled();
    expect(
      screen.getByRole("radio", { name: /modelo_com_cabecalho/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole("radio", { name: /modelo_pendente/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole("radiogroup", { name: "Seleção do modelo" }),
    ).toBeVisible();

    fireEvent.click(
      screen.getByRole("radio", { name: /retomar_atendimento/i }),
    );
    expect(screen.getByText("Olá, cliente! Podemos continuar por aqui?")).toBeVisible();
    expect(screen.getByRole("button", { name: "Ativar proteção" })).toBeDisabled();
    expect(document.querySelector("main")?.className).toContain("min-h-dvh");
  });

  it("shows failed and stale states without enabling activation at 390px", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    });
    render(
      <WhatsAppPolicyScreen
        initialSettings={settings({
          assignment: {
            templateId: approvedTemplate.id,
            name: approvedTemplate.name,
            language: "pt_BR",
            previewBody: "Olá, cliente! Podemos continuar por aqui?",
          },
          canActivate: false,
          lastSync: {
            status: "FAILED",
            attemptedAt: "2026-08-24T12:00:00.000Z",
            succeededAt: "2026-08-20T12:00:00.000Z",
            failureCode: "UPSTREAM_ERROR",
          },
          readinessReason: "SYNC_STALE",
        })}
      />,
    );

    expect(screen.getByText(/A última tentativa falhou/)).toHaveTextContent(
      "última válida em 20/08/2026, 09:00",
    );
    expect(screen.getByText("A sincronização precisa ser atualizada")).toBeVisible();
    expect(screen.getByRole("button", { name: "Ativar proteção" })).toBeDisabled();
    expect(document.querySelector("main")?.className).toContain("overflow-x-hidden");
  });

  it("synchronizes once, locks double clicks and replaces all state from the response", async () => {
    let resolveFetch!: (value: Response) => void;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise<Response>((resolve) => { resolveFetch = resolve; }),
    );
    render(<WhatsAppPolicyScreen initialSettings={settings({ templates: [] })} />);
    const button = screen.getByRole("button", { name: "Sincronizar com a Meta" });

    fireEvent.click(button);
    fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    resolveFetch(envelope(settings()));

    await waitFor(() =>
      expect(screen.getByRole("radio", { name: /retomar_atendimento/i })).toBeVisible(),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Modelos sincronizados com a Meta.",
    );
  });

  it("reconciles the persisted dashboard after an HTTP sync failure", async () => {
    const failed = settings({
      lastSync: {
        status: "FAILED",
        attemptedAt: "2026-08-24T12:30:00.000Z",
        succeededAt: "2026-08-24T12:00:00.000Z",
        failureCode: "WHATSAPP_TEMPLATE_SYNC_FAILED",
      },
      canActivate: false,
      readinessReason: "SYNC_STALE",
    });
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        json: async () => ({
          data: null,
          error: { code: "WHATSAPP_TEMPLATE_SYNC_FAILED", message: "safe" },
        }),
      } as Response)
      .mockResolvedValueOnce(envelope(failed));
    render(<WhatsAppPolicyScreen initialSettings={settings()} />);

    fireEvent.click(screen.getByRole("button", { name: "Sincronizar com a Meta" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/settings/whatsapp",
      expect.objectContaining({ cache: "no-store", method: "GET" }),
    );
    expect(screen.getByText(/A última tentativa falhou/)).toHaveTextContent(
      "última válida em 24/08/2026, 09:00",
    );
    expect(screen.getByText("A sincronização precisa ser atualizada")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Não foi possível sincronizar os modelos com a Meta.",
    );
  });

  it("assigns the selected internal template UUID and accepts the authoritative response", async () => {
    const assigned = settings({
      templates: [{ ...approvedTemplate, assigned: true }],
      assignment: {
        templateId: approvedTemplate.id,
        name: approvedTemplate.name,
        language: "pt_BR",
        previewBody: "Olá, cliente! Podemos continuar por aqui?",
      },
      canActivate: true,
      readinessReason: null,
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(envelope(assigned));
    render(<WhatsAppPolicyScreen initialSettings={settings()} />);
    fireEvent.click(screen.getByRole("radio", { name: /retomar_atendimento/i }));
    fireEvent.click(screen.getByRole("button", { name: "Usar para retomada" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/settings/whatsapp",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          action: "ASSIGN_TEMPLATE",
          templateId: approvedTemplate.id,
        }),
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Ativar proteção" })).toBeEnabled(),
    );
  });

  it("blocks activation while a different template is selected but not assigned", () => {
    const alternative = {
      ...approvedTemplate,
      id: "10000000-0000-4000-8000-000000000004",
      name: "retomar_atendimento_alternativo",
    };
    const ready = settings({
      templates: [{ ...approvedTemplate, assigned: true }, alternative],
      assignment: {
        templateId: approvedTemplate.id,
        name: approvedTemplate.name,
        language: "pt_BR",
        previewBody: "Olá, cliente! Podemos continuar por aqui?",
      },
      canActivate: true,
      readinessReason: null,
    });
    render(<WhatsAppPolicyScreen initialSettings={ready} />);
    expect(screen.getByRole("button", { name: "Ativar proteção" })).toBeEnabled();

    fireEvent.click(
      screen.getByRole("radio", { name: /retomar_atendimento_alternativo/i }),
    );

    expect(screen.getByRole("button", { name: "Ativar proteção" })).toBeDisabled();
    expect(screen.getByText("Salve o modelo selecionado antes de ativar")).toBeVisible();
  });

  it("requires explicit activation and destructive deactivation confirmation with focus restoration", async () => {
    const user = userEvent.setup();
    const ready = settings({
      templates: [{ ...approvedTemplate, assigned: true }],
      assignment: {
        templateId: approvedTemplate.id,
        name: approvedTemplate.name,
        language: "pt_BR",
        previewBody: "Olá, cliente! Podemos continuar por aqui?",
      },
      canActivate: true,
      readinessReason: null,
    });
    const active = settings({ ...ready, mode: "ACTIVE", version: 1 });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(envelope(active))
      .mockResolvedValueOnce(envelope(ready));
    render(<WhatsAppPolicyScreen initialSettings={ready} />);
    const activate = screen.getByRole("button", { name: "Ativar proteção" });

    await user.click(activate);
    const activationDialog = screen.getByRole("alertdialog", {
      name: "Ativar proteção da janela",
    });
    expect(
      within(activationDialog).getByText(/mensagens livres serão bloqueadas/i),
    ).toBeVisible();
    await user.click(within(activationDialog).getByRole("button", { name: "Ativar proteção" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Desativar proteção" })).toHaveFocus(),
    );

    const deactivate = screen.getByRole("button", { name: "Desativar proteção" });
    await user.click(deactivate);
    const deactivationDialog = screen.getByRole("alertdialog", {
      name: "Desativar proteção da janela",
    });
    await user.click(within(deactivationDialog).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(deactivate).toHaveFocus());
    await user.click(deactivate);
    await user.click(
      within(
        screen.getByRole("alertdialog", {
          name: "Desativar proteção da janela",
        }),
      ).getByRole("button", { name: "Desativar proteção" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Ativar proteção" })).toHaveFocus(),
    );
  });

  it("restores focus to activation after the server refuses the change", async () => {
    const user = userEvent.setup();
    const ready = settings({
      templates: [{ ...approvedTemplate, assigned: true }],
      assignment: {
        templateId: approvedTemplate.id,
        name: approvedTemplate.name,
        language: "pt_BR",
        previewBody: "Olá, cliente! Podemos continuar por aqui?",
      },
      canActivate: true,
      readinessReason: null,
    });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({ data: null, error: { code: "CONFLICT", message: "safe" } }),
      } as Response)
      .mockResolvedValueOnce(envelope(ready));
    render(<WhatsAppPolicyScreen initialSettings={ready} />);
    const activate = screen.getByRole("button", { name: "Ativar proteção" });

    await user.click(activate);
    await user.click(
      within(screen.getByRole("alertdialog", { name: "Ativar proteção da janela" }))
        .getByRole("button", { name: "Ativar proteção" }),
    );

    await waitFor(() => expect(activate).toHaveFocus());
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Não foi possível atualizar a configuração do WhatsApp.",
    );
  });

  it("redirects 401 and shows safe network or malformed-response errors", async () => {
    const active = settings({ mode: "ACTIVE", version: 1 });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) } as Response)
      .mockRejectedValueOnce(new Error("token=secret network"))
      .mockResolvedValueOnce(envelope(settings()))
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ token: "secret" }) } as Response)
      .mockResolvedValueOnce(envelope(active));
    render(<WhatsAppPolicyScreen initialSettings={settings()} />);
    const sync = screen.getByRole("button", { name: "Sincronizar com a Meta" });

    fireEvent.click(sync);
    await waitFor(() =>
      expect(routerReplaceMock).toHaveBeenCalledWith(
        "/login?motivo=sessao-expirada",
      ),
    );
    fireEvent.click(sync);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Sem conexão. Confira sua rede e tente novamente.",
      ),
    );
    fireEvent.click(sync);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Resposta inesperada do servidor. Tente novamente.",
      ),
    );
    expect(screen.getByText("Proteção ativa")).toBeVisible();
    expect(screen.queryByText(/token=secret/)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("discards provider-only fields from an otherwise valid response", async () => {
    const safeSettings = settings();
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          ...safeSettings,
          accessToken: "provider-secret-token",
          phoneNumberId: "987654321",
          templates: safeSettings.templates.map((template) => ({
            ...template,
            metaId: `meta-${template.id}`,
          })),
        },
        error: null,
      }),
    } as Response);
    render(<WhatsAppPolicyScreen initialSettings={settings({ templates: [] })} />);

    fireEvent.click(screen.getByRole("button", { name: "Sincronizar com a Meta" }));

    await waitFor(() =>
      expect(screen.getByText("Modelos sincronizados com a Meta.")).toBeVisible(),
    );
    expect(screen.queryByText(/provider-secret-token|987654321|meta-/)).not.toBeInTheDocument();
  });
});
