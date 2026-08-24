import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "prisma/migrations/202608230003_meta_health/migration.sql",
);

describe("meta health migration", () => {
  it("creates additive snapshot and alert storage with leases and acknowledgement", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain('CREATE TABLE "meta_health_snapshots"');
    expect(sql).toContain('CREATE TABLE "meta_operational_alerts"');
    expect(sql).toContain('"sync_lease_until" TIMESTAMPTZ(3)');
    expect(sql).toContain('"acknowledged_by_user_id" UUID');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "meta_health_snapshots_phone_number_id_key"',
    );
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "meta_operational_alerts_deduplication_key_key"',
    );
  });

  it("keeps the migration additive and preserves alert history on user deletion", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).not.toMatch(/\b(?:DROP|TRUNCATE)\b/i);
    expect(sql).toMatch(
      /FOREIGN KEY \("acknowledged_by_user_id"\) REFERENCES "users"\("id"\)\s+ON DELETE SET NULL/u,
    );
    expect(sql).toMatch(
      /FOREIGN KEY \("snapshot_id"\) REFERENCES "meta_health_snapshots"\("id"\)\s+ON DELETE CASCADE/u,
    );
  });
});
