// @vitest-environment node

import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { resetTestDatabase } from "@/test/database";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for quoted reply contract tests");
}

const pg = new Pool({ connectionString: testDatabaseUrl });
const contactId = "51000000-0000-4000-8000-000000000001";
const conversationId = "51000000-0000-4000-8000-000000000002";
const originalId = "51000000-0000-4000-8000-000000000003";
const firstReplyId = "51000000-0000-4000-8000-000000000004";
const secondReplyId = "51000000-0000-4000-8000-000000000005";

async function insertConversation(): Promise<void> {
  await pg.query(`
    INSERT INTO contacts (id, whatsapp_id, phone, name, updated_at)
    VALUES ($1, '556151000001', '556151000001', 'Quoted reply contract', CURRENT_TIMESTAMP)
  `, [contactId]);
  await pg.query(`
    INSERT INTO conversations (id, contact_id, last_message_at, updated_at)
    VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [conversationId, contactId]);
}

async function insertMessage(input: {
  id: string;
  whatsappMessageId: string;
  replyToMessageId?: string;
  replyToWhatsappMessageId?: string;
}): Promise<void> {
  await pg.query(`
    INSERT INTO messages (
      id,
      conversation_id,
      whatsapp_message_id,
      reply_to_message_id,
      reply_to_whatsapp_message_id,
      direction,
      type,
      body,
      status,
      external_timestamp,
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, 'INBOUND', 'TEXT', 'Contract', 'RECEIVED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [
    input.id,
    conversationId,
    input.whatsappMessageId,
    input.replyToMessageId ?? null,
    input.replyToWhatsappMessageId ?? null,
  ]);
}

describe("WhatsApp quoted reply schema contract", () => {
  beforeEach(resetTestDatabase);

  afterAll(async () => {
    await Promise.all([pg.end(), prisma.$disconnect()]);
  });

  it("creates nullable reply columns, the self foreign key, and lookup indexes", async () => {
    const columns = await pg.query<{
      column_name: string;
      is_nullable: "YES" | "NO";
      data_type: string;
    }>(`
      SELECT column_name, is_nullable, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'messages'
        AND column_name IN ('reply_to_message_id', 'reply_to_whatsapp_message_id')
      ORDER BY column_name
    `);
    const foreignKeys = await pg.query<{
      column_name: string;
      foreign_table_name: string;
      foreign_column_name: string;
      delete_rule: string;
    }>(`
      SELECT
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name,
        rc.delete_rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.constraint_schema = kcu.constraint_schema
      JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name
        AND tc.constraint_schema = ccu.constraint_schema
      JOIN information_schema.referential_constraints rc
        ON tc.constraint_name = rc.constraint_name
        AND tc.constraint_schema = rc.constraint_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_name = 'messages'
        AND kcu.column_name = 'reply_to_message_id'
    `);
    const indexes = await pg.query<{ indexname: string }>(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'messages'
        AND indexname IN (
          'messages_reply_to_message_id_idx',
          'messages_reply_external_lookup_idx'
        )
      ORDER BY indexname
    `);

    expect(columns.rows).toEqual([
      {
        column_name: "reply_to_message_id",
        is_nullable: "YES",
        data_type: "uuid",
      },
      {
        column_name: "reply_to_whatsapp_message_id",
        is_nullable: "YES",
        data_type: "text",
      },
    ]);
    expect(foreignKeys.rows).toEqual([{
      column_name: "reply_to_message_id",
      foreign_table_name: "messages",
      foreign_column_name: "id",
      delete_rule: "SET NULL",
    }]);
    expect(indexes.rows.map(({ indexname }) => indexname)).toEqual([
      "messages_reply_external_lookup_idx",
      "messages_reply_to_message_id_idx",
    ]);
  });

  it("keeps legacy rows nullable and records the additive migration in Prisma's ledger", async () => {
    await insertConversation();
    await insertMessage({ id: originalId, whatsappMessageId: "wamid.contract-original" });

    const legacy = await pg.query<{
      reply_to_message_id: string | null;
      reply_to_whatsapp_message_id: string | null;
    }>(`
      SELECT reply_to_message_id, reply_to_whatsapp_message_id
      FROM messages
      WHERE id = $1
    `, [originalId]);
    const migration = await pg.query<{ migration_name: string }>(`
      SELECT migration_name
      FROM _prisma_migrations
      WHERE migration_name = '202608220004_quoted_replies'
        AND finished_at IS NOT NULL
        AND rolled_back_at IS NULL
    `);

    expect(legacy.rows).toEqual([{
      reply_to_message_id: null,
      reply_to_whatsapp_message_id: null,
    }]);
    expect(migration.rows).toEqual([{
      migration_name: "202608220004_quoted_replies",
    }]);
  });

  it("rejects an unknown local target and allows several replies to one original", async () => {
    await insertConversation();
    await insertMessage({ id: originalId, whatsappMessageId: "wamid.contract-original" });

    await expect(insertMessage({
      id: firstReplyId,
      whatsappMessageId: "wamid.contract-invalid-reply",
      replyToMessageId: "51000000-0000-4000-8000-999999999999",
      replyToWhatsappMessageId: "wamid.contract-missing",
    })).rejects.toMatchObject({ code: "23503" });

    await insertMessage({
      id: firstReplyId,
      whatsappMessageId: "wamid.contract-first-reply",
      replyToMessageId: originalId,
      replyToWhatsappMessageId: "wamid.contract-original",
    });
    await insertMessage({
      id: secondReplyId,
      whatsappMessageId: "wamid.contract-second-reply",
      replyToMessageId: originalId,
      replyToWhatsappMessageId: "wamid.contract-original",
    });

    const replies = await pg.query<{ reply_to_message_id: string | null }>(`
      SELECT reply_to_message_id
      FROM messages
      WHERE id IN ($1, $2)
      ORDER BY id
    `, [firstReplyId, secondReplyId]);

    expect(replies.rows).toEqual([
      { reply_to_message_id: originalId },
      { reply_to_message_id: originalId },
    ]);
  });

  it("sets the local link to null while preserving the official fallback on original deletion", async () => {
    await insertConversation();
    await insertMessage({ id: originalId, whatsappMessageId: "wamid.contract-original" });
    await insertMessage({
      id: firstReplyId,
      whatsappMessageId: "wamid.contract-first-reply",
      replyToMessageId: originalId,
      replyToWhatsappMessageId: "wamid.contract-original",
    });

    await pg.query("DELETE FROM messages WHERE id = $1", [originalId]);
    const reply = await pg.query<{
      reply_to_message_id: string | null;
      reply_to_whatsapp_message_id: string | null;
    }>(`
      SELECT reply_to_message_id, reply_to_whatsapp_message_id
      FROM messages
      WHERE id = $1
    `, [firstReplyId]);

    expect(reply.rows).toEqual([{
      reply_to_message_id: null,
      reply_to_whatsapp_message_id: "wamid.contract-original",
    }]);
  });
});
