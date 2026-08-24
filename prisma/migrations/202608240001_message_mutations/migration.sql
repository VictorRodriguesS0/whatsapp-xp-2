CREATE TYPE "MessageRevisionAction" AS ENUM ('EDIT', 'REVOKE');

ALTER TABLE "messages"
  ADD COLUMN "edited_at" TIMESTAMPTZ(3),
  ADD COLUMN "last_mutation_at" TIMESTAMPTZ(3);

CREATE TABLE "message_revisions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "message_id" UUID NOT NULL,
  "provider_event_id" TEXT NOT NULL,
  "action" "MessageRevisionAction" NOT NULL,
  "provider_timestamp" TIMESTAMPTZ(3) NOT NULL,
  "previous_body" TEXT,
  "previous_content" JSONB,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "message_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "message_revisions_message_id_fkey"
    FOREIGN KEY ("message_id") REFERENCES "messages"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "message_revisions_provider_event_id_key"
  ON "message_revisions"("provider_event_id");

CREATE INDEX "message_revisions_message_id_provider_timestamp_provider_event_id_idx"
  ON "message_revisions"("message_id", "provider_timestamp", "provider_event_id");
