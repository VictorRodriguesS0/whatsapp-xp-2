// @vitest-environment node

import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { resetTestDatabase } from "@/test/database";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for echo identity contract tests");
}

const pg = new Pool({ connectionString: testDatabaseUrl });

describe("WhatsApp echo identity schema contract", () => {
  beforeEach(resetTestDatabase);

  afterAll(async () => {
    await Promise.all([pg.end(), prisma.$disconnect()]);
  });

  it("adds a nullable BSUID without invalidating existing phone contacts", async () => {
    await pg.query(`
      INSERT INTO contacts (id, whatsapp_id, phone, name, updated_at)
      VALUES (
        '40000000-0000-4000-8000-000000000001',
        '551100000001',
        '551100000001',
        'Legacy contact',
        CURRENT_TIMESTAMP
      )
    `);

    const columns = await pg.query<{
      column_name: string;
      is_nullable: "YES" | "NO";
    }>(`
      SELECT column_name, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'contacts'
        AND column_name IN ('whatsapp_id', 'phone', 'whatsapp_user_id')
      ORDER BY column_name
    `);
    const legacy = await pg.query<{
      whatsapp_id: string | null;
      phone: string | null;
      whatsapp_user_id: string | null;
    }>(`
      SELECT whatsapp_id, phone, whatsapp_user_id
      FROM contacts
      WHERE id = '40000000-0000-4000-8000-000000000001'
    `);

    expect(columns.rows).toEqual([
      { column_name: "phone", is_nullable: "YES" },
      { column_name: "whatsapp_id", is_nullable: "YES" },
      { column_name: "whatsapp_user_id", is_nullable: "YES" },
    ]);
    expect(legacy.rows).toEqual([
      {
        whatsapp_id: "551100000001",
        phone: "551100000001",
        whatsapp_user_id: null,
      },
    ]);
  });

  it("accepts BSUID-only contacts but rejects contacts without an identity", async () => {
    await expect(
      pg.query(`
        INSERT INTO contacts (id, whatsapp_user_id, name, updated_at)
        VALUES (
          '40000000-0000-4000-8000-000000000002',
          'BR.ContractCustomer',
          'WhatsApp',
          CURRENT_TIMESTAMP
        )
      `),
    ).resolves.toBeDefined();

    await expect(
      pg.query(`
        INSERT INTO contacts (id, name, updated_at)
        VALUES (
          '40000000-0000-4000-8000-000000000003',
          'Identityless',
          CURRENT_TIMESTAMP
        )
      `),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("allows actorless outbound echoes without weakening internal outbound ownership", async () => {
    await pg.query(`
      INSERT INTO contacts (id, whatsapp_user_id, name, updated_at)
      VALUES (
        '40000000-0000-4000-8000-000000000004',
        'BR.ActorlessCustomer',
        'WhatsApp',
        CURRENT_TIMESTAMP
      );
      INSERT INTO conversations (id, contact_id, last_message_at, updated_at)
      VALUES (
        '40000000-0000-4000-8000-000000000005',
        '40000000-0000-4000-8000-000000000004',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      );
    `);

    await expect(
      pg.query(`
        INSERT INTO messages (
          id, conversation_id, whatsapp_message_id, direction, type, status,
          external_timestamp, updated_at
        ) VALUES (
          '40000000-0000-4000-8000-000000000006',
          '40000000-0000-4000-8000-000000000005',
          'wamid.contract-echo',
          'OUTBOUND',
          'TEXT',
          'SENT',
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
      `),
    ).resolves.toBeDefined();

    await expect(
      pg.query(`
        INSERT INTO messages (
          id, conversation_id, client_request_id, direction, type, status,
          external_timestamp, updated_at
        ) VALUES (
          '40000000-0000-4000-8000-000000000007',
          '40000000-0000-4000-8000-000000000005',
          '40000000-0000-4000-8000-000000000008',
          'OUTBOUND',
          'TEXT',
          'PENDING',
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
      `),
    ).rejects.toMatchObject({ code: "23514" });
  });
});
