WITH expected AS (
  SELECT
    c.id,
    first_inbound.external_timestamp AS awaiting_response_since
  FROM conversations c
  LEFT JOIN LATERAL (
    SELECT m.external_timestamp, m.id
    FROM messages m
    WHERE m.conversation_id = c.id
      AND m.direction = 'OUTBOUND'
    ORDER BY m.external_timestamp DESC, m.id DESC
    LIMIT 1
  ) latest_outbound ON TRUE
  LEFT JOIN LATERAL (
    SELECT m.external_timestamp
    FROM messages m
    WHERE m.conversation_id = c.id
      AND m.direction = 'INBOUND'
      AND (
        latest_outbound.id IS NULL
        OR (m.external_timestamp, m.id) >
           (latest_outbound.external_timestamp, latest_outbound.id)
      )
    ORDER BY m.external_timestamp ASC, m.id ASC
    LIMIT 1
  ) first_inbound ON TRUE
)
UPDATE conversations c
SET awaiting_response_since = expected.awaiting_response_since
FROM expected
WHERE c.id = expected.id
  AND c.awaiting_response_since IS DISTINCT FROM expected.awaiting_response_since;
