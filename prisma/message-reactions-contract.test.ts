import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "prisma/migrations/202608220005_message_reactions/migration.sql",
);

describe("message reactions migration contract", () => {
  it("creates current reaction state and a revocation boundary", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toMatch(/CREATE TYPE "ReactionReactor" AS ENUM \('CONTACT', 'BUSINESS'\)/u);
    expect(sql).toMatch(/CREATE TYPE "ReactionStatus" AS ENUM \('PENDING', 'SENT', 'FAILED', 'OUTCOME_UNKNOWN'\)/u);
    expect(sql).toMatch(/ADD COLUMN "revoked_at" TIMESTAMPTZ\(3\)/u);
    expect(sql).toMatch(/CREATE TABLE "message_reactions"/u);
    expect(sql).toMatch(/UNIQUE \("message_id", "reactor"\)/u);
    expect(sql).toMatch(/"client_request_id" UUID/u);
    expect(sql).toMatch(/"provider_timestamp" TIMESTAMPTZ\(3\)/u);
    expect(sql).toMatch(/"sent_by_user_id" UUID/u);
    expect(sql).toMatch(/FOREIGN KEY \("message_id"\).*ON DELETE CASCADE/u);
    expect(sql).toMatch(/FOREIGN KEY \("sent_by_user_id"\).*ON DELETE RESTRICT/u);
  });
});
