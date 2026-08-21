// @vitest-environment node

import { readFile } from "node:fs/promises";

import { Pool } from "pg";
import { describe, expect, it } from "vitest";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for response-state backfill tests");
}

const connectionString: string = testDatabaseUrl;
const migrationDatabaseName = `xp_response_state_backfill_${process.pid}_test`;
const backfillMigration = "202608210004_backfill_response_state";
const migrationsThroughResponseIndex = [
  "202608190001_init",
  "202608200001_media_recovery",
  "202608200002_outbound_delivery_claim",
  "202608210001_shared_inbox_state",
  "202608210002_whatsapp_echo_identities",
  "202608210003_response_state_index",
] as const;

function connectionStringForDatabase(database: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  return url.toString();
}

async function applyMigration(database: Pool, migration: string): Promise<void> {
  await database.query(
    await readFile(
      new URL(`./migrations/${migration}/migration.sql`, import.meta.url),
      "utf8",
    ),
  );
}

async function seedDriftFixtures(database: Pool): Promise<void> {
  await database.query(`
    INSERT INTO users (id, name, email, password_hash, role, active, updated_at) VALUES
      ('00000000-0000-4000-8000-000000000001', 'Fixture User', 'response-state@example.test', 'fixture', 'ADMIN', true, '2026-08-21T09:00:00Z');

    INSERT INTO contacts (id, whatsapp_id, phone, name, updated_at) VALUES
      ('10000000-0000-4000-8000-000000000001', 'fixture-1', '+5500000000001', 'Fixture 1', '2026-08-21T09:00:01Z'),
      ('10000000-0000-4000-8000-000000000002', 'fixture-2', '+5500000000002', 'Fixture 2', '2026-08-21T09:00:02Z'),
      ('10000000-0000-4000-8000-000000000003', 'fixture-3', '+5500000000003', 'Fixture 3', '2026-08-21T09:00:03Z'),
      ('10000000-0000-4000-8000-000000000004', 'fixture-4', '+5500000000004', 'Fixture 4', '2026-08-21T09:00:04Z'),
      ('10000000-0000-4000-8000-000000000005', 'fixture-5', '+5500000000005', 'Fixture 5', '2026-08-21T09:00:05Z'),
      ('10000000-0000-4000-8000-000000000006', 'fixture-6', '+5500000000006', 'Fixture 6', '2026-08-21T09:00:06Z'),
      ('10000000-0000-4000-8000-000000000007', 'fixture-7', '+5500000000007', 'Fixture 7', '2026-08-21T09:00:07Z');

    INSERT INTO conversations (
      id, contact_id, responsible_user_id, last_message_at, created_at, updated_at,
      manual_unread_at, manual_unread_by_user_id, awaiting_response_since
    ) VALUES
      ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '2026-08-21T12:00:00Z', '2026-08-21T09:01:01Z', '2026-08-21T09:02:01Z', '2026-08-21T09:03:01Z', '00000000-0000-4000-8000-000000000001', '2026-08-21T10:00:00Z'),
      ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', NULL, '2026-08-21T11:00:00Z', '2026-08-21T09:01:02Z', '2026-08-21T09:02:02Z', NULL, NULL, '2026-08-21T10:00:00Z'),
      ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003', NULL, '2026-08-21T11:00:00Z', '2026-08-21T09:01:03Z', '2026-08-21T09:02:03Z', NULL, NULL, '2026-08-21T11:00:00Z'),
      ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000004', NULL, '2026-08-21T12:00:00Z', '2026-08-21T09:01:04Z', '2026-08-21T09:02:04Z', NULL, NULL, '2026-08-21T12:00:00Z'),
      ('20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000005', NULL, '2026-08-21T12:00:00Z', '2026-08-21T09:01:05Z', '2026-08-21T09:02:05Z', NULL, NULL, NULL),
      ('20000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000006', NULL, '2026-08-21T12:00:00Z', '2026-08-21T09:01:06Z', '2026-08-21T09:02:06Z', NULL, NULL, '2026-08-21T12:00:00Z'),
      ('20000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000007', NULL, '2026-08-21T09:00:00Z', '2026-08-21T09:01:07Z', '2026-08-21T09:02:07Z', NULL, NULL, '2026-08-21T08:00:00Z');

    INSERT INTO messages (
      id, conversation_id, whatsapp_message_id, direction, type, body,
      sent_by_user_id, status, external_timestamp, updated_at
    ) VALUES
      ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'fixture-1-inbound-10', 'INBOUND', 'TEXT', 'inbound t10', NULL, 'RECEIVED', '2026-08-21T10:00:00Z', '2026-08-21T09:10:01Z'),
      ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'fixture-1-outbound-11', 'OUTBOUND', 'TEXT', 'outbound t11', '00000000-0000-4000-8000-000000000001', 'SENT', '2026-08-21T11:00:00Z', '2026-08-21T09:10:02Z'),
      ('30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', 'fixture-1-inbound-12', 'INBOUND', 'TEXT', 'inbound t12', NULL, 'RECEIVED', '2026-08-21T12:00:00Z', '2026-08-21T09:10:03Z'),
      ('30000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000002', 'fixture-2-inbound-10', 'INBOUND', 'TEXT', 'inbound t10', NULL, 'RECEIVED', '2026-08-21T10:00:00Z', '2026-08-21T09:10:11Z'),
      ('30000000-0000-4000-8000-000000000012', '20000000-0000-4000-8000-000000000002', 'fixture-2-outbound-11', 'OUTBOUND', 'TEXT', 'outbound t11', '00000000-0000-4000-8000-000000000001', 'SENT', '2026-08-21T11:00:00Z', '2026-08-21T09:10:12Z'),
      ('30000000-0000-4000-8000-000000000021', '20000000-0000-4000-8000-000000000003', 'fixture-3-inbound-11', 'INBOUND', 'TEXT', 'inbound t11', NULL, 'RECEIVED', '2026-08-21T11:00:00Z', '2026-08-21T09:10:21Z'),
      ('30000000-0000-4000-8000-000000000022', '20000000-0000-4000-8000-000000000003', 'fixture-3-inbound-10', 'INBOUND', 'TEXT', 'inbound t10', NULL, 'RECEIVED', '2026-08-21T10:00:00Z', '2026-08-21T09:10:22Z'),
      ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004', 'fixture-4-inbound-lower', 'INBOUND', 'TEXT', 'lower inbound', NULL, 'RECEIVED', '2026-08-21T12:00:00Z', '2026-08-21T09:10:31Z'),
      ('40000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000004', 'fixture-4-outbound-higher', 'OUTBOUND', 'TEXT', 'higher outbound', '00000000-0000-4000-8000-000000000001', 'SENT', '2026-08-21T12:00:00Z', '2026-08-21T09:10:32Z'),
      ('50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000005', 'fixture-5-outbound-lower', 'OUTBOUND', 'TEXT', 'lower outbound', '00000000-0000-4000-8000-000000000001', 'SENT', '2026-08-21T12:00:00Z', '2026-08-21T09:10:41Z'),
      ('50000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000005', 'fixture-5-inbound-higher', 'INBOUND', 'TEXT', 'higher inbound', NULL, 'RECEIVED', '2026-08-21T12:00:00Z', '2026-08-21T09:10:42Z'),
      ('60000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000006', 'fixture-6-outbound-lower', 'OUTBOUND', 'TEXT', 'lower outbound', '00000000-0000-4000-8000-000000000001', 'SENT', '2026-08-21T12:00:00Z', '2026-08-21T09:10:51Z'),
      ('60000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000006', 'fixture-6-inbound-higher', 'INBOUND', 'TEXT', 'higher inbound', NULL, 'RECEIVED', '2026-08-21T12:00:00Z', '2026-08-21T09:10:52Z');

    UPDATE conversations
    SET team_last_read_message_id = '30000000-0000-4000-8000-000000000001',
        team_last_read_at = '2026-08-21T10:00:00Z'
    WHERE id = '20000000-0000-4000-8000-000000000001';
  `);
}

async function responseStateDrift(database: Pool): Promise<
  Array<{ id: string; stored: Date | null; expected: Date | null }>
> {
  const result = await database.query<{
    id: string;
    stored: Date | null;
    expected: Date | null;
  }>(`
    WITH expected AS (
      SELECT
        c.id,
        first_inbound.external_timestamp AS awaiting_response_since
      FROM conversations c
      LEFT JOIN LATERAL (
        SELECT m.external_timestamp, m.id
        FROM messages m
        WHERE m.conversation_id = c.id
          AND m.direction = 'OUTBOUND'
        ORDER BY m.external_timestamp DESC, m.id DESC
        LIMIT 1
      ) latest_outbound ON TRUE
      LEFT JOIN LATERAL (
        SELECT m.external_timestamp
        FROM messages m
        WHERE m.conversation_id = c.id
          AND m.direction = 'INBOUND'
          AND (
            latest_outbound.id IS NULL
            OR (m.external_timestamp, m.id) >
               (latest_outbound.external_timestamp, latest_outbound.id)
          )
        ORDER BY m.external_timestamp ASC, m.id ASC
        LIMIT 1
      ) first_inbound ON TRUE
    )
    SELECT
      c.id,
      c.awaiting_response_since AS stored,
      expected.awaiting_response_since AS expected
    FROM conversations c
    JOIN expected ON expected.id = c.id
    WHERE c.awaiting_response_since IS DISTINCT FROM expected.awaiting_response_since
    ORDER BY c.id
  `);

  return result.rows;
}

async function preservedSnapshot(database: Pool): Promise<unknown> {
  const result = await database.query<{ snapshot: unknown }>(`
    SELECT jsonb_build_object(
      'conversationCount', (SELECT COUNT(*)::int FROM conversations),
      'conversationIds', (
        SELECT jsonb_agg(c.id ORDER BY c.id)
        FROM conversations c
      ),
      'conversationOtherFields', (
        SELECT jsonb_agg(
          to_jsonb(c) - 'awaiting_response_since'
          ORDER BY c.id
        )
        FROM conversations c
      ),
      'messageCount', (SELECT COUNT(*)::int FROM messages),
      'messageIds', (
        SELECT jsonb_agg(m.id ORDER BY m.id)
        FROM messages m
      ),
      'messages', (
        SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id)
        FROM messages m
      )
    ) AS snapshot
  `);

  return result.rows[0]?.snapshot;
}

async function conversationRowVersions(
  database: Pool,
): Promise<Array<{ id: string; rowVersion: string }>> {
  const result = await database.query<{ id: string; rowVersion: string }>(`
    SELECT id, xmin::text AS "rowVersion"
    FROM conversations
    ORDER BY id
  `);

  return result.rows;
}

describe("response-state backfill migration", () => {
  it("uses bounded lateral tuple lookups and mismatch-only updates", async () => {
    const migrationSql = await readFile(
      new URL(
        `./migrations/${backfillMigration}/migration.sql`,
        import.meta.url,
      ),
      "utf8",
    );

    expect(migrationSql.match(/LEFT JOIN LATERAL/g)).toHaveLength(2);
    expect(migrationSql).toMatch(
      /ORDER BY m\.external_timestamp DESC, m\.id DESC\s+LIMIT 1/,
    );
    expect(migrationSql).toMatch(
      /\(m\.external_timestamp, m\.id\) >\s+\(latest_outbound\.external_timestamp, latest_outbound\.id\)/,
    );
    expect(migrationSql).toMatch(
      /ORDER BY m\.external_timestamp ASC, m\.id ASC\s+LIMIT 1/,
    );
    expect(migrationSql).toContain("IS DISTINCT FROM");
    expect(migrationSql).not.toContain("updated_at");
  });

  it("recomputes the exact stable unanswered suffix without collateral writes", async () => {
    const admin = new Pool({
      connectionString: connectionStringForDatabase("postgres"),
    });
    let database: Pool | undefined;

    try {
      await admin.query(`DROP DATABASE IF EXISTS "${migrationDatabaseName}" WITH (FORCE)`);
      await admin.query(`CREATE DATABASE "${migrationDatabaseName}"`);
      database = new Pool({
        connectionString: connectionStringForDatabase(migrationDatabaseName),
      });

      for (const migration of migrationsThroughResponseIndex) {
        await applyMigration(database, migration);
      }
      await seedDriftFixtures(database);

      expect(await responseStateDrift(database)).toEqual([
        {
          id: "20000000-0000-4000-8000-000000000001",
          stored: new Date("2026-08-21T10:00:00.000Z"),
          expected: new Date("2026-08-21T12:00:00.000Z"),
        },
        {
          id: "20000000-0000-4000-8000-000000000002",
          stored: new Date("2026-08-21T10:00:00.000Z"),
          expected: null,
        },
        {
          id: "20000000-0000-4000-8000-000000000003",
          stored: new Date("2026-08-21T11:00:00.000Z"),
          expected: new Date("2026-08-21T10:00:00.000Z"),
        },
        {
          id: "20000000-0000-4000-8000-000000000004",
          stored: new Date("2026-08-21T12:00:00.000Z"),
          expected: null,
        },
        {
          id: "20000000-0000-4000-8000-000000000005",
          stored: null,
          expected: new Date("2026-08-21T12:00:00.000Z"),
        },
        {
          id: "20000000-0000-4000-8000-000000000007",
          stored: new Date("2026-08-21T08:00:00.000Z"),
          expected: null,
        },
      ]);
      const snapshotBefore = await preservedSnapshot(database);
      const rowVersionsBefore = await conversationRowVersions(database);

      await applyMigration(database, backfillMigration);

      expect(await responseStateDrift(database)).toEqual([]);
      await expect(
        database.query<{
          id: string;
          awaitingResponseSince: Date | null;
        }>(`
          SELECT id, awaiting_response_since AS "awaitingResponseSince"
          FROM conversations
          ORDER BY id
        `),
      ).resolves.toMatchObject({
        rows: [
          {
            id: "20000000-0000-4000-8000-000000000001",
            awaitingResponseSince: new Date("2026-08-21T12:00:00.000Z"),
          },
          {
            id: "20000000-0000-4000-8000-000000000002",
            awaitingResponseSince: null,
          },
          {
            id: "20000000-0000-4000-8000-000000000003",
            awaitingResponseSince: new Date("2026-08-21T10:00:00.000Z"),
          },
          {
            id: "20000000-0000-4000-8000-000000000004",
            awaitingResponseSince: null,
          },
          {
            id: "20000000-0000-4000-8000-000000000005",
            awaitingResponseSince: new Date("2026-08-21T12:00:00.000Z"),
          },
          {
            id: "20000000-0000-4000-8000-000000000006",
            awaitingResponseSince: new Date("2026-08-21T12:00:00.000Z"),
          },
          {
            id: "20000000-0000-4000-8000-000000000007",
            awaitingResponseSince: null,
          },
        ],
      });
      expect(await preservedSnapshot(database)).toEqual(snapshotBefore);
      const rowVersionsAfter = await conversationRowVersions(database);
      expect(rowVersionsAfter[5]).toEqual(rowVersionsBefore[5]);
      expect(rowVersionsAfter.filter((row, index) =>
        row.rowVersion !== rowVersionsBefore[index]?.rowVersion,
      ).map((row) => row.id)).toEqual([
        "20000000-0000-4000-8000-000000000001",
        "20000000-0000-4000-8000-000000000002",
        "20000000-0000-4000-8000-000000000003",
        "20000000-0000-4000-8000-000000000004",
        "20000000-0000-4000-8000-000000000005",
        "20000000-0000-4000-8000-000000000007",
      ]);

      await applyMigration(database, backfillMigration);

      expect(await responseStateDrift(database)).toEqual([]);
      expect(await preservedSnapshot(database)).toEqual(snapshotBefore);
      expect(await conversationRowVersions(database)).toEqual(rowVersionsAfter);
    } finally {
      await database?.end();
      await admin.query(`DROP DATABASE IF EXISTS "${migrationDatabaseName}" WITH (FORCE)`);
      await admin.end();
    }
  });
});
