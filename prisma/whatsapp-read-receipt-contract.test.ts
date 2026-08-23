// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath = new URL(
  "./migrations/202608230002_whatsapp_read_receipts/migration.sql",
  import.meta.url,
);

describe("WhatsApp read receipt migration", () => {
  it("creates one durable monotonic synchronization row per conversation", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain('CREATE TABLE "whatsapp_read_sync"');
    expect(sql).toMatch(/"conversation_id" UUID PRIMARY KEY/u);
    expect(sql).toMatch(/"target_message_id" UUID NOT NULL/u);
    expect(sql).toMatch(/"confirmed_message_id" UUID/u);
    expect(sql).toMatch(/"failed_target_message_id" UUID/u);
    expect(sql).toMatch(/CHECK \("attempt_count" >= 0\)/u);
    expect(sql).toContain('CREATE INDEX "whatsapp_read_sync_due_idx"');
    expect(sql).toMatch(
      /FOREIGN KEY \("conversation_id"\).*ON DELETE CASCADE/u,
    );
    expect(sql).toMatch(
      /FOREIGN KEY \("target_message_id"\).*ON DELETE CASCADE/u,
    );
  });
});
