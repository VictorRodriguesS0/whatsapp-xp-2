import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";

it("adds rich types and nullable JSON without destructive SQL", async () => {
  const sql = await readFile(
    "prisma/migrations/202608220001_rich_inbound_messages/migration.sql",
    "utf8",
  );

  for (const value of [
    "STICKER",
    "LOCATION",
    "CONTACTS",
    "INTERACTIVE",
    "ORDER",
    "SYSTEM",
  ]) {
    expect(sql).toContain(`ADD VALUE IF NOT EXISTS '${value}'`);
  }

  expect(sql).toContain('ADD COLUMN "content" JSONB');
  expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM/i);
});
