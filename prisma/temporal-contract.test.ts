// @vitest-environment node

import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

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
const execFileAsync = promisify(execFile);

const migrationDatabaseName = `xp_atendimento_shared_inbox_${process.pid}_test`;
const contactMigrationDatabaseName = `xp_atendimento_contact_types_${process.pid}_test`;
const deployDatabaseName = `xp_atendimento_migrate_deploy_${process.pid}_test`;
const contactMigration = "202608210006_contact_classification";
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const prismaCli = fileURLToPath(
  new URL("../node_modules/prisma/build/index.js", import.meta.url),
);

function connectionStringForDatabase(database: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  return url.toString();
}

async function resetContactClassification(): Promise<void> {
  const tables = await pg.query<{
    contact_types: string | null;
    tag_definitions: string | null;
  }>(`
    SELECT
      to_regclass('public.contact_types')::text AS contact_types,
      to_regclass('public.contact_tag_definitions')::text AS tag_definitions
  `);

  if (tables.rows[0]?.contact_types) {
    await pg.query('DELETE FROM "contact_types"');
  }
  if (tables.rows[0]?.tag_definitions) {
    await pg.query('DELETE FROM "contact_tag_definitions"');
  }
}

async function deployMigrations(databaseUrl: string): Promise<void> {
  await execFileAsync(process.execPath, [prismaCli, "migrate", "deploy"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      TEST_DATABASE_URL: databaseUrl,
    },
    maxBuffer: 1024 * 1024,
    timeout: 60_000,
  });
}

describe("shared inbox temporal schema contract", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    await resetContactClassification();
  });

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

  it("defines the additive contact-classification migration with fixed defaults", async () => {
    const sql = await readFile(
      new URL(`./migrations/${contactMigration}/migration.sql`, import.meta.url),
      "utf8",
    );

    for (const id of [
      "10000000-0000-4000-8000-000000000001",
      "10000000-0000-4000-8000-000000000002",
      "10000000-0000-4000-8000-000000000003",
      "10000000-0000-4000-8000-000000000004",
    ]) {
      expect(sql).toContain(id);
    }
    expect(sql).toMatch(
      /ON CONFLICT \("normalized_name"\) DO NOTHING/i,
    );
    expect(sql).toContain(
      `CONSTRAINT "contact_types_color_check" CHECK ("color" ~ '^#[0-9A-F]{6}$')`,
    );
    expect(sql).toContain(
      `CONSTRAINT "contact_tag_definitions_color_check" CHECK ("color" ~ '^#[0-9A-F]{6}$')`,
    );
  });

  it.each([
    {
      table: "contact_types",
      constraint: "contact_types_color_check",
    },
    {
      table: "contact_tag_definitions",
      constraint: "contact_tag_definitions_color_check",
    },
  ])("rejects non-#RRGGBB colors in $table", async ({ table, constraint }) => {
    for (const [index, color] of [
      "123456",
      "#12345",
      "#12345G",
      "#abcdef",
      "#1234567",
    ].entries()) {
      await expect(
        pg.query(
          `
            INSERT INTO "${table}" (
              id, display_name, normalized_name, color, position, updated_at
            ) VALUES ($1::uuid, $2, $3, $4, $5, CURRENT_TIMESTAMP)
          `,
          [
            `50000000-0000-4000-8000-00000000000${index + 1}`,
            `Invalid color ${index}`,
            `invalid-color-${index}`,
            color,
            index,
          ],
        ),
      ).rejects.toMatchObject({ code: "23514", constraint });
    }
  });

  it("keeps Prisma migrate deploy idempotent on a fresh dedicated database", async () => {
    const admin = new Pool({
      connectionString: connectionStringForDatabase("postgres"),
    });
    const deployDatabaseUrl = connectionStringForDatabase(deployDatabaseName);
    let deployed: Pool | undefined;

    try {
      await admin.query(
        `DROP DATABASE IF EXISTS "${deployDatabaseName}" WITH (FORCE)`,
      );
      await admin.query(`CREATE DATABASE "${deployDatabaseName}"`);

      await deployMigrations(deployDatabaseUrl);
      deployed = new Pool({ connectionString: deployDatabaseUrl });
      const firstLedger = await deployed.query<{
        migration_name: string;
        checksum: string;
        finished: boolean;
        active: boolean;
      }>(`
        SELECT
          migration_name,
          checksum,
          finished_at IS NOT NULL AS finished,
          rolled_back_at IS NULL AS active
        FROM _prisma_migrations
        ORDER BY migration_name
      `);

      await deployMigrations(deployDatabaseUrl);
      const secondLedger = await deployed.query<{
        migration_name: string;
        checksum: string;
        finished: boolean;
        active: boolean;
      }>(`
        SELECT
          migration_name,
          checksum,
          finished_at IS NOT NULL AS finished,
          rolled_back_at IS NULL AS active
        FROM _prisma_migrations
        ORDER BY migration_name
      `);

      const expectedMigrations = (
        await readdir(new URL("./migrations/", import.meta.url), {
          withFileTypes: true,
        })
      )
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
      expect(firstLedger.rows.map(({ migration_name }) => migration_name)).toEqual(
        expectedMigrations,
      );
      expect(firstLedger.rows.every(({ finished, active }) => finished && active)).toBe(
        true,
      );
      expect(secondLedger.rows).toEqual(firstLedger.rows);
    } finally {
      try {
        await deployed?.end();
      } finally {
        try {
          await admin.query(
            `DROP DATABASE IF EXISTS "${deployDatabaseName}" WITH (FORCE)`,
          );
        } finally {
          await admin.end();
        }
      }
    }
  });

  it("stores every contact-classification timestamp with timezone awareness", async () => {
    const columns = await pg.query<{
      table_name: string;
      column_name: string;
      data_type: string;
    }>(`
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_name IN (
          'contact_types',
          'contact_tag_definitions',
          'contact_tag_assignments'
        )
        AND column_name IN ('created_at', 'updated_at')
      ORDER BY table_name, column_name
    `);

    expect(columns.rows).toEqual([
      {
        table_name: "contact_tag_assignments",
        column_name: "created_at",
        data_type: "timestamp with time zone",
      },
      {
        table_name: "contact_tag_definitions",
        column_name: "created_at",
        data_type: "timestamp with time zone",
      },
      {
        table_name: "contact_tag_definitions",
        column_name: "updated_at",
        data_type: "timestamp with time zone",
      },
      {
        table_name: "contact_types",
        column_name: "created_at",
        data_type: "timestamp with time zone",
      },
      {
        table_name: "contact_types",
        column_name: "updated_at",
        data_type: "timestamp with time zone",
      },
    ]);
  });

  it("creates the contact-classification foreign keys with the required delete actions", async () => {
    const foreignKeys = await pg.query<{
      table_name: string;
      column_name: string;
      foreign_table_name: string;
      delete_rule: string;
    }>(`
      SELECT
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        rc.delete_rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.constraint_schema = tc.constraint_schema
      JOIN information_schema.referential_constraints rc
        ON rc.constraint_name = tc.constraint_name
        AND rc.constraint_schema = tc.constraint_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND (
          (tc.table_name = 'contacts' AND kcu.column_name = 'contact_type_id')
          OR tc.table_name = 'contact_tag_assignments'
        )
      ORDER BY tc.table_name, kcu.column_name
    `);

    expect(foreignKeys.rows).toEqual([
      {
        table_name: "contact_tag_assignments",
        column_name: "contact_id",
        foreign_table_name: "contacts",
        delete_rule: "CASCADE",
      },
      {
        table_name: "contact_tag_assignments",
        column_name: "tag_id",
        foreign_table_name: "contact_tag_definitions",
        delete_rule: "RESTRICT",
      },
      {
        table_name: "contacts",
        column_name: "contact_type_id",
        foreign_table_name: "contact_types",
        delete_rule: "SET NULL",
      },
    ]);
  });

  it("creates normalized-name uniqueness, assignment uniqueness, and ordered lookup indexes", async () => {
    const indexes = await pg.query<{
      table_name: string;
      index_name: string;
      is_unique: boolean;
      is_primary: boolean;
      columns: string[];
    }>(`
      SELECT
        table_class.relname AS table_name,
        index_class.relname AS index_name,
        index.indisunique AS is_unique,
        index.indisprimary AS is_primary,
        array_agg(attribute.attname::text ORDER BY key.ordinality) AS columns
      FROM pg_index index
      JOIN pg_class table_class ON table_class.oid = index.indrelid
      JOIN pg_namespace namespace ON namespace.oid = table_class.relnamespace
      JOIN pg_class index_class ON index_class.oid = index.indexrelid
      JOIN LATERAL unnest(index.indkey) WITH ORDINALITY AS key(attnum, ordinality)
        ON true
      JOIN pg_attribute attribute
        ON attribute.attrelid = table_class.oid
        AND attribute.attnum = key.attnum
      WHERE namespace.nspname = 'public'
        AND index_class.relname IN (
          'contact_types_normalized_name_key',
          'contact_types_active_position_idx',
          'contact_tag_definitions_normalized_name_key',
          'contact_tag_definitions_active_position_idx',
          'contact_tag_assignments_pkey',
          'contact_tag_assignments_tag_id_contact_id_idx'
        )
      GROUP BY
        table_class.relname,
        index_class.relname,
        index.indisunique,
        index.indisprimary
      ORDER BY index_class.relname
    `);

    expect(indexes.rows).toEqual([
      {
        table_name: "contact_tag_assignments",
        index_name: "contact_tag_assignments_pkey",
        is_unique: true,
        is_primary: true,
        columns: ["contact_id", "tag_id"],
      },
      {
        table_name: "contact_tag_assignments",
        index_name: "contact_tag_assignments_tag_id_contact_id_idx",
        is_unique: false,
        is_primary: false,
        columns: ["tag_id", "contact_id"],
      },
      {
        table_name: "contact_tag_definitions",
        index_name: "contact_tag_definitions_active_position_idx",
        is_unique: false,
        is_primary: false,
        columns: ["active", "position"],
      },
      {
        table_name: "contact_tag_definitions",
        index_name: "contact_tag_definitions_normalized_name_key",
        is_unique: true,
        is_primary: false,
        columns: ["normalized_name"],
      },
      {
        table_name: "contact_types",
        index_name: "contact_types_active_position_idx",
        is_unique: false,
        is_primary: false,
        columns: ["active", "position"],
      },
      {
        table_name: "contact_types",
        index_name: "contact_types_normalized_name_key",
        is_unique: true,
        is_primary: false,
        columns: ["normalized_name"],
      },
    ]);
  });

  it("keeps definitions and assignments when they are deactivated", async () => {
    await pg.query(`
      INSERT INTO contact_types (
        id, display_name, normalized_name, color, position, updated_at
      ) VALUES (
        '20000000-0000-4000-8000-000000000001',
        'Fixture type',
        'fixture type',
        '#123456',
        10,
        CURRENT_TIMESTAMP
      );
      INSERT INTO contact_tag_definitions (
        id, display_name, normalized_name, color, position, updated_at
      ) VALUES (
        '20000000-0000-4000-8000-000000000002',
        'Fixture tag',
        'fixture tag',
        '#654321',
        10,
        CURRENT_TIMESTAMP
      );
      INSERT INTO contacts (
        id, whatsapp_id, name, contact_type_id, updated_at
      ) VALUES (
        '20000000-0000-4000-8000-000000000003',
        'fixture-contact-classification',
        'Fixture contact',
        '20000000-0000-4000-8000-000000000001',
        CURRENT_TIMESTAMP
      );
      INSERT INTO contact_tag_assignments (contact_id, tag_id) VALUES (
        '20000000-0000-4000-8000-000000000003',
        '20000000-0000-4000-8000-000000000002'
      );
      UPDATE contact_types SET active = false
        WHERE id = '20000000-0000-4000-8000-000000000001';
      UPDATE contact_tag_definitions SET active = false
        WHERE id = '20000000-0000-4000-8000-000000000002';
    `);

    const retained = await pg.query<{
      type_active: boolean;
      tag_active: boolean;
      assignments: number;
    }>(`
      SELECT
        (SELECT active FROM contact_types
          WHERE id = '20000000-0000-4000-8000-000000000001') AS type_active,
        (SELECT active FROM contact_tag_definitions
          WHERE id = '20000000-0000-4000-8000-000000000002') AS tag_active,
        (SELECT count(*)::int FROM contact_tag_assignments
          WHERE contact_id = '20000000-0000-4000-8000-000000000003') AS assignments
    `);

    expect(retained.rows).toEqual([
      { type_active: false, tag_active: false, assignments: 1 },
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

  it("adds contact classification without changing legacy contact, conversation, or message identity", async () => {
    const admin = new Pool({
      connectionString: connectionStringForDatabase("postgres"),
    });
    let legacy: Pool | undefined;

    try {
      await admin.query(
        `DROP DATABASE IF EXISTS "${contactMigrationDatabaseName}" WITH (FORCE)`,
      );
      await admin.query(`CREATE DATABASE "${contactMigrationDatabaseName}"`);
      legacy = new Pool({
        connectionString: connectionStringForDatabase(
          contactMigrationDatabaseName,
        ),
      });

      for (const migration of [
        "202608190001_init",
        "202608200001_media_recovery",
        "202608200002_outbound_delivery_claim",
        "202608210001_shared_inbox_state",
        "202608210002_whatsapp_echo_identities",
        "202608210003_response_state_index",
        "202608210004_backfill_response_state",
        "202608210005_media_terminal_transition",
      ]) {
        await legacy.query(
          await readFile(
            new URL(`./migrations/${migration}/migration.sql`, import.meta.url),
            "utf8",
          ),
        );
      }

      await legacy.query(`
        INSERT INTO contacts (
          id, whatsapp_id, whatsapp_user_id, phone, name, updated_at
        ) VALUES (
          '30000000-0000-4000-8000-000000000001',
          'legacy-whatsapp-id',
          'legacy-whatsapp-user-id',
          '+5500000000001',
          'Latest Meta profile name',
          '2026-08-21T12:00:00Z'
        );
        INSERT INTO conversations (
          id, contact_id, last_message_at, updated_at
        ) VALUES (
          '30000000-0000-4000-8000-000000000002',
          '30000000-0000-4000-8000-000000000001',
          '2026-08-21T12:01:00Z',
          '2026-08-21T12:01:00Z'
        );
        INSERT INTO messages (
          id, conversation_id, whatsapp_message_id, direction, type, status,
          external_timestamp, updated_at
        ) VALUES (
          '30000000-0000-4000-8000-000000000003',
          '30000000-0000-4000-8000-000000000002',
          'legacy-message-id',
          'INBOUND',
          'TEXT',
          'RECEIVED',
          '2026-08-21T12:01:00Z',
          '2026-08-21T12:01:00Z'
        );
      `);

      await legacy.query(
        await readFile(
          new URL(`./migrations/${contactMigration}/migration.sql`, import.meta.url),
          "utf8",
        ),
      );

      const defaultTypes = await legacy.query<{
        id: string;
        display_name: string;
        normalized_name: string;
        color: string;
        position: number;
        active: boolean;
      }>(`
        SELECT
          id::text,
          display_name,
          normalized_name,
          color,
          position,
          active
        FROM contact_types
        ORDER BY position
      `);
      expect(defaultTypes.rows).toEqual([
        {
          id: "10000000-0000-4000-8000-000000000001",
          display_name: "Cliente",
          normalized_name: "cliente",
          color: "#176B52",
          position: 10,
          active: true,
        },
        {
          id: "10000000-0000-4000-8000-000000000002",
          display_name: "Interessado",
          normalized_name: "interessado",
          color: "#2563EB",
          position: 20,
          active: true,
        },
        {
          id: "10000000-0000-4000-8000-000000000003",
          display_name: "Fornecedor/Parceiro",
          normalized_name: "fornecedor/parceiro",
          color: "#B7791F",
          position: 30,
          active: true,
        },
        {
          id: "10000000-0000-4000-8000-000000000004",
          display_name: "Não cliente",
          normalized_name: "não cliente",
          color: "#6D746F",
          position: 40,
          active: true,
        },
      ]);

      const legacyRows = await legacy.query<{
        name: string;
        whatsapp_id: string;
        whatsapp_user_id: string;
        preferred_name: string | null;
        contact_type_id: string | null;
        conversation_id: string;
        whatsapp_message_id: string;
      }>(`
        SELECT
          contact.name,
          contact.whatsapp_id,
          contact.whatsapp_user_id,
          contact.preferred_name,
          contact.contact_type_id::text,
          conversation.id::text AS conversation_id,
          message.whatsapp_message_id
        FROM contacts contact
        JOIN conversations conversation ON conversation.contact_id = contact.id
        JOIN messages message ON message.conversation_id = conversation.id
        WHERE contact.id = '30000000-0000-4000-8000-000000000001'
      `);

      expect(legacyRows.rows).toEqual([
        {
          name: "Latest Meta profile name",
          whatsapp_id: "legacy-whatsapp-id",
          whatsapp_user_id: "legacy-whatsapp-user-id",
          preferred_name: null,
          contact_type_id: null,
          conversation_id: "30000000-0000-4000-8000-000000000002",
          whatsapp_message_id: "legacy-message-id",
        },
      ]);
    } finally {
      await legacy?.end();
      await admin.query(
        `DROP DATABASE IF EXISTS "${contactMigrationDatabaseName}" WITH (FORCE)`,
      );
      await admin.end();
    }
  });
});
