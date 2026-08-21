CREATE TYPE "ConversationAuditAction" AS ENUM ('READ', 'MARKED_UNREAD');

ALTER TABLE "conversations"
  ADD COLUMN "team_last_read_message_id" UUID,
  ADD COLUMN "team_last_read_at" TIMESTAMPTZ(3),
  ADD COLUMN "manual_unread_at" TIMESTAMPTZ(3),
  ADD COLUMN "manual_unread_by_user_id" UUID,
  ADD COLUMN "awaiting_response_since" TIMESTAMPTZ(3);

CREATE TABLE "conversation_audit_events" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "action" "ConversationAuditAction" NOT NULL,
    "message_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_audit_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "conversation_audit_events_conversation_id_created_at_idx"
  ON "conversation_audit_events"("conversation_id", "created_at");

ALTER TABLE "conversations"
  ADD CONSTRAINT "conversations_team_last_read_message_id_fkey"
    FOREIGN KEY ("team_last_read_message_id") REFERENCES "messages"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "conversations_manual_unread_by_user_id_fkey"
    FOREIGN KEY ("manual_unread_by_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "conversation_audit_events"
  ADD CONSTRAINT "conversation_audit_events_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "conversation_audit_events_actor_user_id_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

WITH highest AS (
  SELECT DISTINCT ON (cr.conversation_id)
    cr.conversation_id,
    cr.last_read_message_id,
    cr.last_read_at
  FROM conversation_reads cr
  LEFT JOIN messages m ON m.id = cr.last_read_message_id
  ORDER BY cr.conversation_id,
    COALESCE(m.external_timestamp, cr.last_read_at) DESC,
    m.id DESC NULLS LAST
)
UPDATE conversations c
SET team_last_read_message_id = h.last_read_message_id,
    team_last_read_at = h.last_read_at
FROM highest h
WHERE c.id = h.conversation_id;

WITH latest AS (
  SELECT DISTINCT ON (conversation_id)
    conversation_id, direction
  FROM messages
  ORDER BY conversation_id, external_timestamp DESC, id DESC
), last_outbound AS (
  SELECT DISTINCT ON (conversation_id)
    conversation_id, external_timestamp, id
  FROM messages
  WHERE direction = 'OUTBOUND'
  ORDER BY conversation_id, external_timestamp DESC, id DESC
), trailing_inbound AS (
  SELECT m.conversation_id, MIN(m.external_timestamp) AS awaiting_since
  FROM messages m
  JOIN latest l ON l.conversation_id = m.conversation_id AND l.direction = 'INBOUND'
  LEFT JOIN last_outbound o ON o.conversation_id = m.conversation_id
  WHERE m.direction = 'INBOUND'
    AND (o.id IS NULL OR (m.external_timestamp, m.id) > (o.external_timestamp, o.id))
  GROUP BY m.conversation_id
)
UPDATE conversations c
SET awaiting_response_since = t.awaiting_since
FROM trailing_inbound t
WHERE c.id = t.conversation_id;
