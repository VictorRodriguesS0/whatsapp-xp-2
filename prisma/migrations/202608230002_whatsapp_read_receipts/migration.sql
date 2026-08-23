CREATE TYPE "ReadReceiptFailureKind" AS ENUM ('TRANSIENT', 'REJECTED');

CREATE TABLE "whatsapp_read_sync" (
  "conversation_id" UUID PRIMARY KEY,
  "target_message_id" UUID NOT NULL,
  "confirmed_message_id" UUID,
  "failed_target_message_id" UUID,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMPTZ(3),
  "lease_id" UUID,
  "lease_until" TIMESTAMPTZ(3),
  "last_failure_kind" "ReadReceiptFailureKind",
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_read_sync_attempt_count_check" CHECK ("attempt_count" >= 0),
  CONSTRAINT "whatsapp_read_sync_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "whatsapp_read_sync_target_message_id_fkey" FOREIGN KEY ("target_message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "whatsapp_read_sync_confirmed_message_id_fkey" FOREIGN KEY ("confirmed_message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "whatsapp_read_sync_failed_target_message_id_fkey" FOREIGN KEY ("failed_target_message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "whatsapp_read_sync_due_idx"
  ON "whatsapp_read_sync" ("next_attempt_at", "lease_until");
