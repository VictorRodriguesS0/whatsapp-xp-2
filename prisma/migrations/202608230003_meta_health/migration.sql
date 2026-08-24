CREATE TYPE "MetaAlertCategory" AS ENUM (
  'PHONE_QUALITY',
  'ACCOUNT',
  'ACCOUNT_REVIEW',
  'PHONE_NAME',
  'TEMPLATE'
);

CREATE TYPE "MetaAlertSeverity" AS ENUM ('INFO', 'ATTENTION', 'CRITICAL');
CREATE TYPE "MetaAlertSource" AS ENUM ('WEBHOOK', 'RECONCILIATION');

CREATE TABLE "meta_health_snapshots" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "phone_number_id" TEXT NOT NULL,
  "waba_id" TEXT NOT NULL,
  "display_phone_number" TEXT,
  "verified_name" TEXT,
  "quality_rating" TEXT,
  "account_review_status" TEXT,
  "account_event" TEXT,
  "messaging_limit" TEXT,
  "last_sync_attempt_at" TIMESTAMPTZ(3),
  "last_successful_sync_at" TIMESTAMPTZ(3),
  "last_sync_error_code" TEXT,
  "sync_lease_id" UUID,
  "sync_lease_until" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "meta_health_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "meta_operational_alerts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "snapshot_id" UUID NOT NULL,
  "deduplication_key" TEXT,
  "category" "MetaAlertCategory" NOT NULL,
  "severity" "MetaAlertSeverity" NOT NULL,
  "source" "MetaAlertSource" NOT NULL,
  "source_field" TEXT NOT NULL,
  "event_code" TEXT NOT NULL,
  "resource_id" TEXT,
  "summary" TEXT NOT NULL,
  "details" JSONB,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "resolved_at" TIMESTAMPTZ(3),
  "acknowledged_at" TIMESTAMPTZ(3),
  "acknowledged_by_user_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "meta_operational_alerts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "meta_health_snapshots_phone_number_id_key"
  ON "meta_health_snapshots"("phone_number_id");

CREATE INDEX "meta_health_snapshots_sync_lease_until_idx"
  ON "meta_health_snapshots"("sync_lease_until");

CREATE UNIQUE INDEX "meta_operational_alerts_deduplication_key_key"
  ON "meta_operational_alerts"("deduplication_key");

CREATE INDEX "meta_operational_alerts_snapshot_id_active_severity_occurred_at_idx"
  ON "meta_operational_alerts"("snapshot_id", "active", "severity", "occurred_at");

CREATE INDEX "meta_operational_alerts_occurred_at_id_idx"
  ON "meta_operational_alerts"("occurred_at", "id");

ALTER TABLE "meta_operational_alerts"
  ADD CONSTRAINT "meta_operational_alerts_snapshot_id_fkey"
    FOREIGN KEY ("snapshot_id") REFERENCES "meta_health_snapshots"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "meta_operational_alerts"
  ADD CONSTRAINT "meta_operational_alerts_acknowledged_by_user_id_fkey"
    FOREIGN KEY ("acknowledged_by_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
