// @vitest-environment node

import { readFile } from "node:fs/promises";

import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { resetTestDatabase } from "@/test/database";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for temporal contract tests");
}

const connectionString: string = testDatabaseUrl;
const pg = new Pool({ connectionString });

const migrationDatabaseName = `xp_atendimento_shared_inbox_${process.pid}_test`;

function connectionStringForDatabase(database: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  return url.toString();
}

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

  it("backfills the highest read boundary and first trailing inbound timestamp from legacy data", async () => {
    const admin = new Pool({ connectionString: connectionStringForDatabase("postgres") });
    let legacy: Pool | undefined;

    try {
      await admin.query(`DROP DATABASE IF EXISTS "${migrationDatabaseName}" WITH (FORCE)`);
      await admin.query(`CREATE DATABASE "${migrationDatabaseName}"`);
      legacy = new Pool({
        connectionString: connectionStringForDatabase(migrationDatabaseName),
      });

      for (const migration of [
        "202608190001_init",
        "202608200001_media_recovery",
        "202608200002_outbound_delivery_claim",
      ]) {
        await legacy.query(
          await readFile(
            new URL(`./migrations/${migration}/migration.sql`, import.meta.url),
            "utf8",
          ),
        );
      }

      await legacy.query(`
        INSERT INTO users (id, name, email, password_hash, role, active, updated_at) VALUES
          ('00000000-0000-4000-8000-000000000001', 'Fixture One', 'fixture-one@example.test', 'fixture', 'ADMIN', true, '2026-08-18T14:00:00Z'),
          ('00000000-0000-4000-8000-000000000002', 'Fixture Two', 'fixture-two@example.test', 'fixture', 'ATTENDANT', true, '2026-08-18T14:00:00Z');
        INSERT INTO contacts (id, whatsapp_id, phone, name, updated_at) VALUES
          ('00000000-0000-4000-8000-000000000101', 'fixture-contact', '+5500000000000', 'Fixture Contact', '2026-08-18T14:00:00Z');
        INSERT INTO conversations (id, contact_id, last_message_at, updated_at) VALUES
          ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000101', '2026-08-18T14:02:00Z', '2026-08-18T14:00:00Z');
        INSERT INTO messages (id, conversation_id, whatsapp_message_id, direction, type, status, sent_by_user_id, external_timestamp, updated_at) VALUES
          ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000201', 'fixture-outbound', 'OUTBOUND', 'TEXT', 'SENT', '00000000-0000-4000-8000-000000000001', '2026-08-18T14:00:00Z', '2026-08-18T14:00:00Z'),
          ('00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000201', 'fixture-inbound-one', 'INBOUND', 'TEXT', 'RECEIVED', NULL, '2026-08-18T14:01:00Z', '2026-08-18T14:00:00Z'),
          ('00000000-0000-4000-8000-000000000303', '00000000-0000-4000-8000-000000000201', 'fixture-inbound-two', 'INBOUND', 'TEXT', 'RECEIVED', NULL, '2026-08-18T14:01:00Z', '2026-08-18T14:00:00Z'),
          ('00000000-0000-4000-8000-000000000304', '00000000-0000-4000-8000-000000000201', 'fixture-inbound-three', 'INBOUND', 'TEXT', 'RECEIVED', NULL, '2026-08-18T14:02:00Z', '2026-08-18T14:00:00Z');
        INSERT INTO conversation_reads (id, conversation_id, user_id, last_read_message_id, last_read_at) VALUES
          ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000302', '2026-08-18T14:03:00Z'),
          ('00000000-0000-4000-8000-000000000402', '00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000303', '2026-08-18T14:03:00Z');
      `);

      await legacy.query(
        await readFile(
          new URL(
            "./migrations/202608210001_shared_inbox_state/migration.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      );

      const boundary = await legacy.query<{
        team_last_read_message_id: string;
        team_last_read_at: Date;
        awaiting_response_since: Date;
      }>(`
        SELECT team_last_read_message_id, team_last_read_at, awaiting_response_since
        FROM conversations
        WHERE id = '00000000-0000-4000-8000-000000000201'
      `);

      expect(boundary.rows).toEqual([
        {
          team_last_read_message_id: "00000000-0000-4000-8000-000000000303",
          team_last_read_at: new Date("2026-08-18T14:03:00.000Z"),
          awaiting_response_since: new Date("2026-08-18T14:01:00.000Z"),
        },
      ]);
    } finally {
      await legacy?.end();
      await admin.query(`DROP DATABASE IF EXISTS "${migrationDatabaseName}" WITH (FORCE)`);
      await admin.end();
    }
  });
});
