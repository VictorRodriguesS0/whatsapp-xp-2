import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MetaAlertPageDto, MetaHealthSummaryDto, MetaOperationalAlertDto } from "@/modules/meta-health/types";

import { MetaHealthScreen } from "./meta-health-screen";

const hookState = vi.hoisted(() => ({ sync: vi.fn(), refresh: vi.fn(), syncing: false, syncResult: null as null | { status: string; success: boolean } }));
vi.mock("@/hooks/use-meta-health", () => ({ useMetaHealth: (summary: MetaHealthSummaryDto) => ({ ...hookState, summary }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/components/theme/theme-menu", () => ({ ThemeMenu: () => <button aria-label="Tema" type="button" /> }));

const summary: MetaHealthSummaryDto = {
  label: "CRITICAL",
  unacknowledgedCount: 2,
  stale: false,
  phone: { displayPhoneNumber: "+55 61 9514-9019", verifiedName: "XP Eletrônicos", qualityRating: "RED" },
  account: { reviewStatus: "APPROVED", event: "DISABLED_UPDATE", messagingLimit: "TIER_10K" },
  lastSuccessfulSyncAt: "2026-08-23T12:00:00.000Z",
  lastSyncAttemptAt: "2026-08-23T12:00:00.000Z",
  lastSyncErrorCode: null,
};

const activeAlert: MetaOperationalAlertDto = {
  id: "10000000-0000-4000-8000-000000000001",
  category: "ACCOUNT",
  severity: "CRITICAL",
  source: "WEBHOOK",
  sourceField: "account_update",
  eventCode: "ACCOUNT_DISABLED",
  resourceId: "waba-1",
  summary: "Conta desativada pela Meta",
  details: null,
  occurredAt: "2026-08-23T11:00:00.000Z",
  active: true,
  resolvedAt: null,
  acknowledgedAt: null,
  acknowledgedBy: null,
};

const historyAlert: MetaOperationalAlertDto = {
  ...activeAlert,
  id: "20000000-0000-4000-8000-000000000002",
  severity: "INFO",
  eventCode: "ACCOUNT_REINSTATED",
  summary: "Conta restabelecida pela Meta",
  active: false,
  occurredAt: "2026-08-22T11:00:00.000Z",
  resolvedAt: "2026-08-22T11:00:00.000Z",
};

const page: MetaAlertPageDto = { alerts: [activeAlert, historyAlert], nextCursor: null };

describe("MetaHealthScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hookState.syncing = false;
    hookState.syncResult = null;
  });
  afterEach(() => vi.unstubAllGlobals());

  it("uses the shared settings shell", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/meta-health/meta-health-screen.tsx"), "utf8");

    expect(source).toContain("SettingsPageShell");
  });

  it("shows current operational state, active alerts before history and no raw payload", () => {
    render(<MetaHealthScreen initialAlerts={page} initialSummary={summary} />);
    expect(screen.getByRole("heading", { name: "Saúde da Meta" })).toBeVisible();
    expect(screen.getByText("Qualidade do número")).toBeVisible();
    expect(screen.getByText("Crítica")).toBeVisible();
    expect(screen.getByText("Revisão da conta")).toBeVisible();
    expect(screen.getByText("TIER_10K")).toBeVisible();
    expect(within(screen.getByRole("region", { name: "Alertas ativos" })).getByText("Conta desativada pela Meta")).toBeVisible();
    expect(within(screen.getByRole("region", { name: "Histórico operacional" })).getByText("Conta restabelecida pela Meta")).toBeVisible();
    expect(document.body).not.toHaveTextContent(/account_update|waba-1|sourceField|raw payload/i);
  });

  it("acknowledges once and renders the responsible administrator", async () => {
    const treated = {
      ...activeAlert,
      acknowledgedAt: "2026-08-23T12:30:00.000Z",
      acknowledgedBy: { id: "admin", name: "Administrador XP" },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ alert: treated }), { status: 200 })));
    render(<MetaHealthScreen initialAlerts={{ alerts: [activeAlert], nextCursor: null }} initialSummary={summary} />);
    fireEvent.click(screen.getByRole("button", { name: "Marcar como tratado" }));
    expect(await screen.findByText("Tratado por Administrador XP")).toBeVisible();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps an inline safe acknowledgement error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Bearer secret raw SQL")));
    render(<MetaHealthScreen initialAlerts={{ alerts: [activeAlert], nextCursor: null }} initialSummary={summary} />);
    fireEvent.click(screen.getByRole("button", { name: "Marcar como tratado" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível marcar o alerta como tratado");
    expect(document.body).not.toHaveTextContent(/Bearer secret|raw SQL/);
  });

  it("loads the next history page with the bounded cursor", async () => {
    const nextCursor = { occurredAt: historyAlert.occurredAt, id: historyAlert.id };
    const older = { ...historyAlert, id: "30000000-0000-4000-8000-000000000003", summary: "Revisão aprovada" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ alerts: [older], nextCursor: null }), { status: 200 })));
    render(<MetaHealthScreen initialAlerts={{ alerts: [activeAlert], nextCursor }} initialSummary={summary} />);
    fireEvent.click(screen.getByRole("button", { name: "Carregar histórico anterior" }));
    expect(await screen.findByText("Revisão aprovada")).toBeVisible();
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toContain("cursorId=20000000-0000-4000-8000-000000000002");
  });

  it("reports a rate-limited manual refresh without replacing the current state", async () => {
    hookState.sync.mockResolvedValue({ status: "RATE_LIMITED", success: true });
    render(<MetaHealthScreen initialAlerts={page} initialSummary={summary} />);
    fireEvent.click(screen.getByRole("button", { name: "Atualizar agora" }));
    await waitFor(() => expect(hookState.sync).toHaveBeenCalledOnce());
    expect(await screen.findByText("Aguarde um minuto antes de atualizar novamente.")).toBeVisible();
  });

  it("explains stale and failed synchronization safely", () => {
    render(<MetaHealthScreen
      initialAlerts={{ alerts: [], nextCursor: null }}
      initialSummary={{ ...summary, label: "STALE", stale: true, lastSyncErrorCode: "META_TIMEOUT" }}
    />);
    expect(screen.getByText("Os dados da Meta estão sem atualização recente.")).toBeVisible();
    expect(screen.getByText("A última consulta à Meta não respondeu a tempo.")).toBeVisible();
  });
});
