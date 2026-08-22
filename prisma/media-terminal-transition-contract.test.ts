// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";

const migrationUrl = new URL(
  "./migrations/202608210005_media_terminal_transition/migration.sql",
  import.meta.url,
);

describe("media terminal transition migration contract", () => {
  it("is an additive nullable UUID column compatible with the previous application", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    expect(sql).toMatch(/ALTER TABLE "media_objects"\s+ADD COLUMN "terminal_transition_id" UUID;/i);
    expect(sql).not.toMatch(/terminal_transition_id"\s+UUID\s+NOT NULL/i);
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN)|ALTER\s+COLUMN/i);
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)("media terminal transition PostgreSQL contract", () => {
  it("deploys the ownership marker as nullable uuid", async () => {
    const columns = await prisma.$queryRaw<Array<{ data_type: string; is_nullable: string }>>`
      SELECT data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'media_objects'
        AND column_name = 'terminal_transition_id'
    `;

    expect(columns).toEqual([{ data_type: "uuid", is_nullable: "YES" }]);
  });
});
