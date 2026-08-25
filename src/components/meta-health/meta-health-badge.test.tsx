import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { MetaHealthSummaryDto } from "@/modules/meta-health/types";

import { MetaHealthBadge } from "./meta-health-badge";

vi.mock("@/hooks/use-meta-health", () => ({ useMetaHealth: (summary: MetaHealthSummaryDto) => ({ summary }) }));

const base: MetaHealthSummaryDto = {
  label: "NORMAL",
  unacknowledgedCount: 0,
  stale: false,
  phone: { displayPhoneNumber: "+55 61 9514-9019", verifiedName: "XP Eletrônicos", qualityRating: "GREEN" },
  account: { reviewStatus: "APPROVED", event: null, messagingLimit: null },
  lastSuccessfulSyncAt: "2026-08-23T12:00:00.000Z",
  lastSyncAttemptAt: "2026-08-23T12:00:00.000Z",
  lastSyncErrorCode: null,
};

describe("Meta health badge", () => {
  it.each([
    ["NORMAL", "Meta normal"],
    ["ATTENTION", "Meta em atenção"],
    ["CRITICAL", "Meta crítica"],
    ["STALE", "Meta sem atualização"],
  ] as const)("renders accessible %s copy independent of color", (label, text) => {
    render(<MetaHealthBadge initialSummary={{ ...base, label }} />);
    expect(screen.getByRole("link", { name: text })).toHaveAttribute("href", "/configuracoes/meta");
    expect(screen.getByText(text)).toBeVisible();
  });

  it("announces and displays only positive untreated counts", () => {
    render(<MetaHealthBadge initialSummary={{ ...base, label: "CRITICAL", unacknowledgedCount: 2 }} />);
    const link = screen.getByRole("link", { name: "Meta crítica, 2 alertas não tratados" });
    expect(link).toHaveAttribute("href", "/configuracoes/meta");
    expect(screen.getByText("2")).toBeVisible();
    expect(screen.getByText("2")).toHaveClass("bg-[var(--text)]", "text-[var(--canvas)]");
    expect(screen.getByText("2")).not.toHaveClass("text-white");
    expect(link).toHaveClass("focus-visible:ring-2");
    expect(link).toHaveClass("min-h-11");
  });
});
