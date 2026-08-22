CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE messages ADD COLUMN search_text TEXT;

CREATE OR REPLACE FUNCTION build_message_search_text(
  message_body TEXT,
  message_content JSONB,
  message_media_object_id UUID
) RETURNS TEXT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  searchable_parts TEXT;
  media_filename TEXT;
BEGIN
  SELECT original_filename
  INTO media_filename
  FROM media_objects
  WHERE id = message_media_object_id;

  searchable_parts := concat_ws(
    ' ',
    message_body,
    media_filename,
    CASE WHEN message_content ->> 'kind' = 'location' THEN message_content ->> 'name' END,
    CASE WHEN message_content ->> 'kind' = 'location' THEN message_content ->> 'address' END,
    CASE WHEN message_content ->> 'kind' = 'location' THEN message_content ->> 'latitude' END,
    CASE WHEN message_content ->> 'kind' = 'location' THEN message_content ->> 'longitude' END,
    CASE WHEN message_content ->> 'kind' = 'interactive' THEN message_content ->> 'title' END,
    CASE WHEN message_content ->> 'kind' = 'interactive' THEN message_content ->> 'id' END,
    CASE WHEN message_content ->> 'kind' = 'system' THEN message_content ->> 'text' END,
    CASE
      WHEN message_content ->> 'kind' = 'contacts'
        AND jsonb_typeof(message_content -> 'contacts') = 'array'
      THEN (
        SELECT string_agg(
          concat_ws(
            ' ',
            contact ->> 'name',
            (
              SELECT string_agg(concat_ws(' ', phone ->> 'phone', phone ->> 'type'), ' ')
              FROM jsonb_array_elements(
                CASE
                  WHEN jsonb_typeof(contact -> 'phones') = 'array' THEN contact -> 'phones'
                  ELSE '[]'::jsonb
                END
              ) AS phone
            )
          ),
          ' '
        )
        FROM jsonb_array_elements(message_content -> 'contacts') AS contact
      )
    END
  );

  RETURN trim(regexp_replace(lower(normalize(searchable_parts, NFC)), '\s+', ' ', 'g'));
END;
$$;

UPDATE messages
SET search_text = build_message_search_text(body, content, media_object_id);

ALTER TABLE messages
  ALTER COLUMN search_text SET DEFAULT '',
  ALTER COLUMN search_text SET NOT NULL;

CREATE OR REPLACE FUNCTION refresh_message_search_text()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.search_text := build_message_search_text(NEW.body, NEW.content, NEW.media_object_id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER messages_search_text_refresh
BEFORE INSERT OR UPDATE OF body, content, media_object_id
ON messages
FOR EACH ROW
EXECUTE FUNCTION refresh_message_search_text();

CREATE INDEX messages_search_text_trgm_idx
ON messages USING gin (search_text gin_trgm_ops);
