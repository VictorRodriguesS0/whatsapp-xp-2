import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "prisma/migrations/202608220003_message_search/migration.sql",
);

describe("message search migration contract", () => {
  it("backfills searchable content and installs a trigram index", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toMatch(/CREATE EXTENSION IF NOT EXISTS pg_trgm/iu);
    expect(sql).toMatch(/ADD COLUMN search_text/iu);
    expect(sql).toMatch(/media_objects/iu);
    expect(sql).toMatch(/original_filename/iu);
    expect(sql).toMatch(/content\s*->>\s*'address'/iu);
    expect(sql).toMatch(/content\s*->>\s*'latitude'/iu);
    expect(sql).toMatch(/content\s*->>\s*'longitude'/iu);
    expect(sql).toMatch(/CREATE (?:OR REPLACE )?FUNCTION refresh_message_search_text/iu);
    expect(sql).toMatch(/CREATE TRIGGER messages_search_text_refresh/iu);
    expect(sql).toMatch(/USING gin \(search_text gin_trgm_ops\)/iu);
  });
});
