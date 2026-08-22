ALTER TABLE "messages"
  ADD COLUMN "reply_to_message_id" UUID,
  ADD COLUMN "reply_to_whatsapp_message_id" TEXT;

ALTER TABLE "messages"
  ADD CONSTRAINT "messages_reply_to_message_id_fkey"
  FOREIGN KEY ("reply_to_message_id") REFERENCES "messages"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "messages_reply_to_message_id_idx"
  ON "messages"("reply_to_message_id");

CREATE INDEX "messages_reply_external_lookup_idx"
  ON "messages"("conversation_id", "reply_to_whatsapp_message_id");
