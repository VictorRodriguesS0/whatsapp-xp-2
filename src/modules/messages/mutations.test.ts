// @vitest-environment node

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const schemaPath = join(process.cwd(), "prisma/schema.prisma");
const migrationPath = join(
  process.cwd(),
  "prisma/migrations/202608240001_message_mutations/migration.sql",
);

describe("message mutation persistence contract", () => {
  it("defines current mutation state and an internal immutable revision trail", async () => {
    const schema = await readFile(schemaPath, "utf8");

    expect(schema).toContain("enum MessageRevisionAction");
    expect(schema).toMatch(/editedAt\s+DateTime\?/u);
    expect(schema).toMatch(/lastMutationAt\s+DateTime\?/u);
    expect(schema).toContain("model MessageRevision");
    expect(schema).toMatch(/providerEventId\s+String\s+@unique/u);
    expect(schema).toMatch(/previousBody\s+String\?/u);
    expect(schema).toMatch(/previousContent\s+Json\?/u);
  });

  it("adds nullable columns and revisions without destructive message changes", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain('ADD COLUMN "edited_at" TIMESTAMPTZ(3)');
    expect(sql).toContain('ADD COLUMN "last_mutation_at" TIMESTAMPTZ(3)');
    expect(sql).toContain('CREATE TABLE "message_revisions"');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "message_revisions_provider_event_id_key"',
    );
    expect(sql).toContain(
      'CREATE INDEX "message_revisions_message_id_provider_timestamp_provider_event_id_idx"',
    );
    expect(sql).toMatch(
      /IF NEW\.revoked_at IS NOT NULL THEN\s+NEW\.search_text := 'mensagem apagada'/u,
    );
    expect(sql).toMatch(
      /FOREIGN KEY \("message_id"\) REFERENCES "messages"\("id"\)\s+ON DELETE CASCADE/u,
    );
    expect(sql).not.toMatch(/\b(?:DROP|TRUNCATE)\b/iu);
    expect(sql).not.toMatch(/ALTER\s+COLUMN\s+.+SET\s+NOT\s+NULL/iu);
  });
});
