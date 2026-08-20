CREATE TYPE "MessageOperationalState" AS ENUM (
  'READY',
  'UPLOAD_IN_FLIGHT',
  'SEND_IN_FLIGHT',
  'OUTCOME_UNKNOWN',
  'SENT',
  'REJECTED',
  'LOCAL_FAILURE'
);

ALTER TABLE "messages"
  ADD COLUMN "operational_state" "MessageOperationalState" NOT NULL DEFAULT 'READY',
  ADD COLUMN "provider_attempted_at" TIMESTAMPTZ(3);

ALTER TABLE "media_objects"
  ADD COLUMN "download_lease_id" UUID,
  ADD COLUMN "download_lease_until" TIMESTAMPTZ(3),
  ADD COLUMN "download_next_attempt_at" TIMESTAMPTZ(3),
  ADD COLUMN "download_attempts" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "media_objects_download_claim_idx"
  ON "media_objects" ("status", "download_next_attempt_at", "download_lease_until");
