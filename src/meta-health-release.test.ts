import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Meta health integrated release", () => {
  it("contains the additive persistence, five webhook fields, realtime and admin boundaries", () => {
    expect(source("prisma/migrations/202608230003_meta_health/migration.sql")).toContain("meta_health_snapshots");
    const normalization = source("src/modules/webhooks/normalize.ts");
    for (const field of [
      "phone_number_quality_update",
      "account_update",
      "account_review_update",
      "phone_number_name_update",
      "message_template_status_update",
    ]) expect(normalization).toContain(field);
    expect(source("src/modules/realtime/events.ts")).toContain("meta-health.updated");
    for (const path of [
      "src/app/api/meta-health/summary/route.ts",
      "src/app/api/meta-health/alerts/route.ts",
      "src/app/api/meta-health/alerts/[id]/acknowledge/route.ts",
      "src/app/api/meta-health/sync/route.ts",
    ]) expect(source(path)).toContain("requireAdmin");
  });

  it("mounts the admin badge and page with the agreed freshness controls", () => {
    expect(source("src/components/inbox/conversation-sidebar.tsx")).toContain("MetaHealthBadge");
    expect(source("src/app/configuracoes/meta/page.tsx")).toContain("MetaHealthScreen");
    expect(source("src/modules/meta-health/severity.ts")).toContain("15 * 60_000");
    expect(source("src/hooks/use-meta-health.ts")).toContain("60_000");
    expect(source("src/modules/meta-health/service.ts")).toContain("SYNC_LEASE_MS = 60_000");
  });

  it("does not expose the Meta access token to client modules", () => {
    for (const path of [
      "src/hooks/use-meta-health.ts",
      "src/components/meta-health/meta-health-badge.tsx",
      "src/components/meta-health/meta-health-screen.tsx",
      "src/app/configuracoes/meta/page.tsx",
    ]) expect(source(path)).not.toContain("WHATSAPP_ACCESS_TOKEN");
  });
});
