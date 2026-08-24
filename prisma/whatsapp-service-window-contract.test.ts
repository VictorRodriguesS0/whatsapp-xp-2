// @vitest-environment node

import { readFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";

import { Pool } from "pg";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "./migrations/202608230003_whatsapp_service_window_templates/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const migrationName = "202608230003_whatsapp_service_window_templates";
const migrationDatabaseName = `xp_whatsapp_policy_${process.pid}_test`;

if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for WhatsApp policy contracts");
}

const connectionString = testDatabaseUrl;

function connectionStringForDatabase(database: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  return url.toString();
}

async function applyMigration(database: Pool, name: string): Promise<void> {
  await database.query(
    await readFile(
      new URL(`./migrations/${name}/migration.sql`, import.meta.url),
      "utf8",
    ),
  );
}

describe("WhatsApp service-window migration contract", () => {
  it("is additive, inactive by default, and concurrency safe", () => {
    expect(migration).toContain("last_customer_message_at TIMESTAMPTZ(3)");
    expect(migration).toContain("last_customer_message_id UUID");
    expect(migration).toContain("pending_customer_message_at TIMESTAMPTZ(3)");
    expect(migration).toContain("pending_customer_message_id UUID");
    expect(migration).toContain("INSERT INTO whatsapp_policy_configuration");
    expect(migration).toContain("'INACTIVE'");
    expect(migration).toContain(
      "CREATE UNIQUE INDEX conversation_resumptions_active_source_idx",
    );
    expect(migration).toContain(
      "WHERE status IN ('RESERVED', 'SEND_IN_FLIGHT', 'OUTCOME_UNKNOWN', 'SENT')",
    );
    expect(migration).toContain("ROW_NUMBER() OVER");
    expect(migration).not.toMatch(/DROP\s+(?:TABLE|COLUMN)|TRUNCATE/iu);
  });

  it("does not convert legacy awaiting state into automatic consent", () => {
    expect(migration).not.toMatch(
      /SET[\s\S]*pending_customer_message_(?:at|id)[\s\S]*awaiting_response_since/iu,
    );
    expect(migration).not.toMatch(
      /INSERT\s+INTO\s+conversation_resumptions[\s\S]*SELECT/iu,
    );
  });

  it("backfills only the service window and enforces one active resumption", async () => {
    const admin = new Pool({
      connectionString: connectionStringForDatabase("postgres"),
    });
    let database: Pool | undefined;

    try {
      await admin.query(
        `DROP DATABASE IF EXISTS "${migrationDatabaseName}" WITH (FORCE)`,
      );
      await admin.query(`CREATE DATABASE "${migrationDatabaseName}"`);
      database = new Pool({
        connectionString: connectionStringForDatabase(migrationDatabaseName),
      });

      const priorMigrations = (
        await readdir(new URL("./migrations/", import.meta.url), {
          withFileTypes: true,
        })
      )
        .filter((entry) => entry.isDirectory() && entry.name < migrationName)
        .map((entry) => entry.name)
        .sort();

      for (const name of priorMigrations) {
        await applyMigration(database, name);
      }

      await database.query(`
        INSERT INTO users (
          id, name, email, password_hash, role, active, updated_at
        ) VALUES (
          '40000000-0000-4000-8000-000000000001',
          'Policy fixture',
          'policy-fixture@example.test',
          'fixture',
          'ADMIN',
          true,
          '2026-08-23T09:00:00Z'
        );
        INSERT INTO contacts (
          id, whatsapp_id, phone, name, updated_at
        ) VALUES (
          '40000000-0000-4000-8000-000000000002',
          'policy-fixture-contact',
          '+5500000000400',
          'Policy contact',
          '2026-08-23T09:00:00Z'
        );
        INSERT INTO conversations (
          id, contact_id, last_message_at, awaiting_response_since, updated_at
        ) VALUES (
          '40000000-0000-4000-8000-000000000003',
          '40000000-0000-4000-8000-000000000002',
          '2026-08-23T09:03:00Z',
          '2026-08-20T09:00:00Z',
          '2026-08-23T09:03:00Z'
        );
        INSERT INTO messages (
          id, conversation_id, whatsapp_message_id, direction, type, status,
          external_timestamp, updated_at
        ) VALUES
          (
            '40000000-0000-4000-8000-000000000011',
            '40000000-0000-4000-8000-000000000003',
            'policy-inbound-middle',
            'INBOUND', 'TEXT', 'RECEIVED',
            '2026-08-23T09:02:00Z', '2026-08-23T09:02:00Z'
          ),
          (
            '40000000-0000-4000-8000-000000000010',
            '40000000-0000-4000-8000-000000000003',
            'policy-inbound-oldest',
            'INBOUND', 'TEXT', 'RECEIVED',
            '2026-08-23T09:01:00Z', '2026-08-23T09:01:00Z'
          ),
          (
            '40000000-0000-4000-8000-000000000012',
            '40000000-0000-4000-8000-000000000003',
            'policy-inbound-latest',
            'INBOUND', 'TEXT', 'RECEIVED',
            '2026-08-23T09:03:00Z', '2026-08-23T09:03:00Z'
          );
      `);

      await applyMigration(database, migrationName);

      const state = await database.query<{
        last_customer_message_at: Date;
        last_customer_message_id: string;
        pending_customer_message_at: Date | null;
        pending_customer_message_id: string | null;
        awaiting_response_since: Date;
      }>(`
        SELECT
          last_customer_message_at,
          last_customer_message_id::text,
          pending_customer_message_at,
          pending_customer_message_id::text,
          awaiting_response_since
        FROM conversations
        WHERE id = '40000000-0000-4000-8000-000000000003'
      `);
      expect(state.rows).toEqual([
        {
          last_customer_message_at: new Date("2026-08-23T09:03:00.000Z"),
          last_customer_message_id: "40000000-0000-4000-8000-000000000012",
          pending_customer_message_at: null,
          pending_customer_message_id: null,
          awaiting_response_since: new Date("2026-08-20T09:00:00.000Z"),
        },
      ]);

      const policy = await database.query<{
        id: number;
        mode: string;
        version: number;
        sync_status: string;
      }>(`
        SELECT
          id,
          mode::text,
          version,
          last_template_sync_status::text AS sync_status
        FROM whatsapp_policy_configuration
      `);
      expect(policy.rows).toEqual([
        { id: 1, mode: "INACTIVE", version: 0, sync_status: "NEVER" },
      ]);
      await expect(
        database.query(`
          INSERT INTO whatsapp_policy_configuration (id, updated_at)
          VALUES (2, CURRENT_TIMESTAMP)
        `),
      ).rejects.toMatchObject({ code: "23514" });

      await database.query(`
        INSERT INTO whatsapp_templates (
          id, meta_id, name, language, category, status, components,
          body_text, parameter_count, supported, definition_hash, synced_at,
          updated_at
        ) VALUES (
          '40000000-0000-4000-8000-000000000020',
          'meta-policy-template',
          'retomar_atendimento',
          'pt_BR',
          'UTILITY',
          'APPROVED',
          '[]'::jsonb,
          'Olá, {{1}}!',
          1,
          true,
          repeat('a', 64),
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        );
        INSERT INTO conversation_resumptions (
          id, conversation_id, source_message_id, template_id, sent_by_user_id,
          client_request_id, status, rendered_body, template_name,
          template_language, definition_hash, parameters, updated_at
        ) VALUES
          (
            '40000000-0000-4000-8000-000000000021',
            '40000000-0000-4000-8000-000000000003',
            '40000000-0000-4000-8000-000000000010',
            '40000000-0000-4000-8000-000000000020',
            '40000000-0000-4000-8000-000000000001',
            '40000000-0000-4000-8000-000000000031',
            'FAILED',
            'Olá, cliente!',
            'retomar_atendimento',
            'pt_BR',
            repeat('a', 64),
            '[]'::jsonb,
            CURRENT_TIMESTAMP
          ),
          (
            '40000000-0000-4000-8000-000000000022',
            '40000000-0000-4000-8000-000000000003',
            '40000000-0000-4000-8000-000000000010',
            '40000000-0000-4000-8000-000000000020',
            '40000000-0000-4000-8000-000000000001',
            '40000000-0000-4000-8000-000000000032',
            'RESERVED',
            'Olá, cliente!',
            'retomar_atendimento',
            'pt_BR',
            repeat('a', 64),
            '[]'::jsonb,
            CURRENT_TIMESTAMP
          );
      `);
      await expect(
        database.query(`
          INSERT INTO conversation_resumptions (
            id, conversation_id, source_message_id, template_id, sent_by_user_id,
            client_request_id, status, rendered_body, template_name,
            template_language, definition_hash, parameters, updated_at
          ) VALUES (
            '40000000-0000-4000-8000-000000000023',
            '40000000-0000-4000-8000-000000000003',
            '40000000-0000-4000-8000-000000000010',
            '40000000-0000-4000-8000-000000000020',
            '40000000-0000-4000-8000-000000000001',
            '40000000-0000-4000-8000-000000000033',
            'SENT',
            'Olá, cliente!',
            'retomar_atendimento',
            'pt_BR',
            repeat('a', 64),
            '[]'::jsonb,
            CURRENT_TIMESTAMP
          )
        `),
      ).rejects.toMatchObject({
        code: "23505",
        constraint: "conversation_resumptions_active_source_idx",
      });

      await database.query(`
        DELETE FROM messages
        WHERE id = '40000000-0000-4000-8000-000000000012'
      `);
      const deletedPointer = await database.query<{
        last_customer_message_at: Date;
        last_customer_message_id: string | null;
      }>(`
        SELECT last_customer_message_at, last_customer_message_id::text
        FROM conversations
        WHERE id = '40000000-0000-4000-8000-000000000003'
      `);
      expect(deletedPointer.rows).toEqual([
        {
          last_customer_message_at: new Date("2026-08-23T09:03:00.000Z"),
          last_customer_message_id: null,
        },
      ]);
    } finally {
      await database?.end();
      await admin.query(
        `DROP DATABASE IF EXISTS "${migrationDatabaseName}" WITH (FORCE)`,
      );
      await admin.end();
    }
  }, 30_000);
});
