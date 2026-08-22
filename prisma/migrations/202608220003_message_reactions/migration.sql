CREATE TYPE "ReactionReactor" AS ENUM ('CONTACT', 'BUSINESS');
CREATE TYPE "ReactionStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'OUTCOME_UNKNOWN');

ALTER TABLE "messages" ADD COLUMN "revoked_at" TIMESTAMPTZ(3);

CREATE TABLE "message_reactions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "message_id" UUID NOT NULL,
  "reactor" "ReactionReactor" NOT NULL,
  "emoji" TEXT NOT NULL,
  "status" "ReactionStatus" NOT NULL,
  "client_request_id" UUID,
  "provider_message_id" TEXT,
  "provider_event_id" TEXT,
  "provider_timestamp" TIMESTAMPTZ(3),
  "provider_attempted_at" TIMESTAMPTZ(3),
  "sent_by_user_id" UUID,
  "failure_reason" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "message_reactions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "message_reactions_message_id_reactor_key" UNIQUE ("message_id", "reactor"),
  CONSTRAINT "message_reactions_client_request_id_key" UNIQUE ("client_request_id"),
  CONSTRAINT "message_reactions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "message_reactions_sent_by_user_id_fkey" FOREIGN KEY ("sent_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "message_reactions_provider_message_id_idx"
ON "message_reactions"("provider_message_id");
