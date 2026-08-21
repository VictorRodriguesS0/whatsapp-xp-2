// @vitest-environment node

import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { resetTestDatabase } from "@/test/database";

const connectionString = process.env.TEST_DATABASE_URL;

if (!connectionString) {
  throw new Error("TEST_DATABASE_URL is required for temporal contract tests");
}

const pg = new Pool({ connectionString });

describe("shared inbox temporal schema contract", () => {
  beforeEach(resetTestDatabase);

  afterAll(async () => {
    await Promise.all([pg.end(), prisma.$disconnect()]);
  });

  it("stores shared-state timestamps with timezone awareness", async () => {
    const columns = await pg.query<{ column_name: string; data_type: string }>(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'conversations'
        AND column_name IN ('team_last_read_at', 'manual_unread_at', 'awaiting_response_since')
      ORDER BY column_name
    `);

    expect(columns.rows).toEqual([
      { column_name: "awaiting_response_since", data_type: "timestamp with time zone" },
      { column_name: "manual_unread_at", data_type: "timestamp with time zone" },
      { column_name: "team_last_read_at", data_type: "timestamp with time zone" },
    ]);
  });

  it("creates the shared-state foreign keys", async () => {
    const foreignKeys = await pg.query<{
      table_name: string;
      column_name: string;
      foreign_table_name: string;
    }>(`
      SELECT tc.table_name, kcu.column_name, ccu.table_name AS foreign_table_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND (
          (tc.table_name = 'conversations'
            AND kcu.column_name IN ('team_last_read_message_id', 'manual_unread_by_user_id'))
          OR tc.table_name = 'conversation_audit_events'
        )
      ORDER BY tc.table_name, kcu.column_name
    `);

    expect(foreignKeys.rows).toEqual([
      {
        table_name: "conversation_audit_events",
        column_name: "actor_user_id",
        foreign_table_name: "users",
      },
      {
        table_name: "conversation_audit_events",
        column_name: "conversation_id",
        foreign_table_name: "conversations",
      },
      {
        table_name: "conversations",
        column_name: "manual_unread_by_user_id",
        foreign_table_name: "users",
      },
      {
        table_name: "conversations",
        column_name: "team_last_read_message_id",
        foreign_table_name: "messages",
      },
    ]);
  });
});
