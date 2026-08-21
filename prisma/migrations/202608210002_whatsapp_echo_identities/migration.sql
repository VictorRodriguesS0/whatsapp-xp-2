ALTER TABLE "contacts"
  ALTER COLUMN "whatsapp_id" DROP NOT NULL,
  ALTER COLUMN "phone" DROP NOT NULL,
  ADD COLUMN "whatsapp_user_id" TEXT;

CREATE UNIQUE INDEX "contacts_whatsapp_user_id_key"
  ON "contacts"("whatsapp_user_id");

ALTER TABLE "contacts"
  ADD CONSTRAINT "contacts_identity_check"
    CHECK (
      "whatsapp_id" IS NOT NULL
      OR "phone" IS NOT NULL
      OR "whatsapp_user_id" IS NOT NULL
    );

ALTER TABLE "messages"
  DROP CONSTRAINT "messages_outbound_sender_check",
  ADD CONSTRAINT "messages_outbound_sender_check"
    CHECK (
      "direction" <> 'OUTBOUND'
      OR "sent_by_user_id" IS NOT NULL
      OR (
        "client_request_id" IS NULL
        AND "whatsapp_message_id" IS NOT NULL
      )
    );
