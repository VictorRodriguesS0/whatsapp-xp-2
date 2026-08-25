CREATE TYPE "ContactMessagingConsentSource" AS ENUM (
  'WHATSAPP',
  'LOJA_FISICA',
  'TELEFONE',
  'OUTRO'
);

CREATE TYPE "ContactMessagingConsentAction" AS ENUM ('GRANTED', 'REVOKED');

ALTER TABLE "contacts"
  ADD COLUMN "messaging_consent_granted_at" TIMESTAMPTZ(3),
  ADD COLUMN "messaging_consent_source" "ContactMessagingConsentSource",
  ADD COLUMN "messaging_consent_granted_by_user_id" UUID,
  ADD COLUMN "messaging_consent_note" TEXT,
  ADD CONSTRAINT "contact_messaging_consent_current_consistency" CHECK (
    (
      "messaging_consent_granted_at" IS NULL
      AND "messaging_consent_source" IS NULL
      AND "messaging_consent_granted_by_user_id" IS NULL
      AND "messaging_consent_note" IS NULL
    )
    OR
    (
      "messaging_consent_granted_at" IS NOT NULL
      AND "messaging_consent_source" IS NOT NULL
      AND "messaging_consent_granted_by_user_id" IS NOT NULL
      AND (
        (
          "messaging_consent_source" = 'OUTRO'
          AND "messaging_consent_note" IS NOT NULL
          AND char_length("messaging_consent_note") BETWEEN 3 AND 240
        )
        OR
        (
          "messaging_consent_source" <> 'OUTRO'
          AND "messaging_consent_note" IS NULL
        )
      )
    )
  );

CREATE TABLE "contact_messaging_consent_events" (
  "id" UUID NOT NULL,
  "contact_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "action" "ContactMessagingConsentAction" NOT NULL,
  "source" "ContactMessagingConsentSource" NOT NULL,
  "note" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "contact_messaging_consent_events_note_check" CHECK (
    (
      "source" = 'OUTRO'
      AND "note" IS NOT NULL
      AND char_length("note") BETWEEN 3 AND 240
    )
    OR
    (
      "source" <> 'OUTRO'
      AND "note" IS NULL
    )
  ),
  CONSTRAINT "contact_messaging_consent_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "contact_messaging_consent_events_contact_id_created_at_idx"
  ON "contact_messaging_consent_events"("contact_id", "created_at");

ALTER TABLE "contacts"
  ADD CONSTRAINT "contacts_messaging_consent_granted_by_user_id_fkey"
    FOREIGN KEY ("messaging_consent_granted_by_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "contact_messaging_consent_events"
  ADD CONSTRAINT "contact_messaging_consent_events_contact_id_fkey"
    FOREIGN KEY ("contact_id") REFERENCES "contacts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "contact_messaging_consent_events_actor_user_id_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
