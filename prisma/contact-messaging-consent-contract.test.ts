// @vitest-environment node

import { readFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";

import { Pool } from "pg";
import { describe, expect, it } from "vitest";

const migrationName = "202608250001_contact_messaging_consent";
const migration = readFileSync(
  new URL(`./migrations/${migrationName}/migration.sql`, import.meta.url),
  "utf8",
);
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const migrationDatabaseName = `xp_contact_consent_${process.pid}_test`;

if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for contact consent contracts");
}
const requiredTestDatabaseUrl = testDatabaseUrl;

function connectionStringForDatabase(database: string): string {
  const url = new URL(requiredTestDatabaseUrl);
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

describe("contact messaging consent migration contract", () => {
  it("is additive and encodes the consent and audit invariants", () => {
    expect(migration).toContain('CREATE TYPE "ContactMessagingConsentSource"');
    expect(migration).toContain('CREATE TYPE "ContactMessagingConsentAction"');
    expect(migration).toContain(
      'ADD COLUMN "messaging_consent_granted_at" TIMESTAMPTZ(3)',
    );
    expect(migration).toContain(
      'CREATE TABLE "contact_messaging_consent_events"',
    );
    expect(migration).toContain(
      'CONSTRAINT "contact_messaging_consent_current_consistency"',
    );
    expect(migration).toContain(
      'CONSTRAINT "contact_messaging_consent_events_contact_id_fkey"',
    );
    expect(migration).toContain(
      'CONSTRAINT "contact_messaging_consent_events_actor_user_id_fkey"',
    );
    expect(migration).toContain(
      'CREATE INDEX "contact_messaging_consent_events_contact_id_created_at_idx"',
    );
    expect(migration).not.toMatch(/UPDATE\s+"?contacts"?/iu);
    expect(migration).not.toMatch(/DROP\s+(?:TABLE|COLUMN)|TRUNCATE/iu);
  });

  it("leaves legacy contacts without consent and enforces consistent current state", async () => {
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
          '50000000-0000-4000-8000-000000000001',
          'Consent fixture',
          'consent-fixture@example.test',
          'fixture',
          'ATTENDANT',
          true,
          '2026-08-25T09:00:00Z'
        );
        INSERT INTO contacts (
          id, whatsapp_id, phone, name, updated_at
        ) VALUES (
          '50000000-0000-4000-8000-000000000002',
          'consent-legacy-contact',
          '+5500000000500',
          'Legacy consent contact',
          '2026-08-25T09:00:00Z'
        );
      `);

      await applyMigration(database, migrationName);

      const legacy = await database.query<{
        granted_at: Date | null;
        source: string | null;
        actor_id: string | null;
        note: string | null;
      }>(`
        SELECT
          messaging_consent_granted_at AS granted_at,
          messaging_consent_source::text AS source,
          messaging_consent_granted_by_user_id::text AS actor_id,
          messaging_consent_note AS note
        FROM contacts
        WHERE id = '50000000-0000-4000-8000-000000000002'
      `);
      expect(legacy.rows).toEqual([
        { granted_at: null, source: null, actor_id: null, note: null },
      ]);

      await expect(
        database.query(`
          UPDATE contacts
          SET messaging_consent_source = 'WHATSAPP'
          WHERE id = '50000000-0000-4000-8000-000000000002'
        `),
      ).rejects.toMatchObject({
        code: "23514",
        constraint: "contact_messaging_consent_current_consistency",
      });

      await expect(
        database.query(`
          UPDATE contacts
          SET
            messaging_consent_granted_at = CURRENT_TIMESTAMP,
            messaging_consent_source = 'OUTRO',
            messaging_consent_granted_by_user_id = '50000000-0000-4000-8000-000000000001',
            messaging_consent_note = NULL
          WHERE id = '50000000-0000-4000-8000-000000000002'
        `),
      ).rejects.toMatchObject({
        code: "23514",
        constraint: "contact_messaging_consent_current_consistency",
      });

      await database.query(`
        UPDATE contacts
        SET
          messaging_consent_granted_at = '2026-08-25T09:10:00Z',
          messaging_consent_source = 'LOJA_FISICA',
          messaging_consent_granted_by_user_id = '50000000-0000-4000-8000-000000000001',
          messaging_consent_note = NULL
        WHERE id = '50000000-0000-4000-8000-000000000002';

        INSERT INTO contact_messaging_consent_events (
          id, contact_id, actor_user_id, action, source, note
        ) VALUES (
          '50000000-0000-4000-8000-000000000003',
          '50000000-0000-4000-8000-000000000002',
          '50000000-0000-4000-8000-000000000001',
          'GRANTED',
          'LOJA_FISICA',
          NULL
        );
      `);

      const events = await database.query<{
        action: string;
        source: string;
        note: string | null;
      }>(`
        SELECT action::text, source::text, note
        FROM contact_messaging_consent_events
        WHERE contact_id = '50000000-0000-4000-8000-000000000002'
      `);
      expect(events.rows).toEqual([
        { action: "GRANTED", source: "LOJA_FISICA", note: null },
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
