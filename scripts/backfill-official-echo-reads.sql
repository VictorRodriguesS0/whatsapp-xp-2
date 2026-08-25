-- Preview (default):
--   psql --set ON_ERROR_STOP=1 --file scripts/backfill-official-echo-reads.sql
-- Apply once after validating the preview:
--   psql --set ON_ERROR_STOP=1 --set apply=1 --file scripts/backfill-official-echo-reads.sql
-- A second preview must report candidate_count = 0.

\set ON_ERROR_STOP on
\if :{?apply}
\else
\set apply 0
\endif

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TEMPORARY TABLE official_echo_read_candidates
ON COMMIT DROP
AS
WITH latest_official_echo AS (
  SELECT DISTINCT ON (m.conversation_id)
    m.conversation_id,
    m.id,
    m.external_timestamp
  FROM messages AS m
  INNER JOIN webhook_events AS we
    ON we.deduplication_key = 'message-echo:' || m.whatsapp_message_id
   AND we.event_type = 'messageEcho'
   AND we.status = 'PROCESSED'
  WHERE m.direction = 'OUTBOUND'
    AND m.sent_by_user_id IS NULL
    AND m.client_request_id IS NULL
    AND m.whatsapp_message_id IS NOT NULL
  ORDER BY m.conversation_id, m.external_timestamp DESC, m.id DESC
), latest_preceding_inbound AS (
  SELECT
    o.conversation_id,
    i.id AS target_message_id,
    i.external_timestamp AS target_at
  FROM latest_official_echo AS o
  JOIN LATERAL (
    SELECT i.id, i.external_timestamp
    FROM messages AS i
    WHERE i.conversation_id = o.conversation_id
      AND i.direction = 'INBOUND'
      AND (
        i.external_timestamp < o.external_timestamp
        OR (
          i.external_timestamp = o.external_timestamp
          AND i.id < o.id
        )
      )
    ORDER BY i.external_timestamp DESC, i.id DESC
    LIMIT 1
  ) AS i ON true
)
SELECT
  target.conversation_id,
  target.target_message_id,
  target.target_at
FROM latest_preceding_inbound AS target
INNER JOIN conversations AS c ON c.id = target.conversation_id
LEFT JOIN messages AS current_boundary
  ON current_boundary.id = c.team_last_read_message_id
WHERE (
  c.team_last_read_message_id IS NULL
  AND (
    c.team_last_read_at IS NULL
    OR target.target_at > c.team_last_read_at
  )
) OR (
  current_boundary.external_timestamp < target.target_at
  OR (
    current_boundary.external_timestamp = target.target_at
    AND current_boundary.id < target.target_message_id
  )
);

SELECT count(*) AS candidate_count
FROM official_echo_read_candidates;

\if :apply
CREATE TEMPORARY TABLE official_echo_read_applied
ON COMMIT DROP
AS
WITH locked AS (
  SELECT c.id
  FROM conversations AS c
  INNER JOIN official_echo_read_candidates AS candidate
    ON candidate.conversation_id = c.id
  ORDER BY c.id
  FOR UPDATE OF c
), updated AS (
  UPDATE conversations AS c
  SET
    team_last_read_message_id = candidate.target_message_id,
    team_last_read_at = candidate.target_at
  FROM official_echo_read_candidates AS candidate
  INNER JOIN locked ON locked.id = candidate.conversation_id
  WHERE c.id = candidate.conversation_id
    AND (
      (
        c.team_last_read_message_id IS NULL
        AND (
          c.team_last_read_at IS NULL
          OR candidate.target_at > c.team_last_read_at
        )
      )
      OR EXISTS (
        SELECT 1
        FROM messages AS current_boundary
        WHERE current_boundary.id = c.team_last_read_message_id
          AND (
            current_boundary.external_timestamp < candidate.target_at
            OR (
              current_boundary.external_timestamp = candidate.target_at
              AND current_boundary.id < candidate.target_message_id
            )
          )
      )
    )
  RETURNING c.id
)
SELECT id FROM updated;

SELECT count(*) AS applied_count
FROM official_echo_read_applied;
\else
SELECT 0::bigint AS applied_count;
\endif

COMMIT;
