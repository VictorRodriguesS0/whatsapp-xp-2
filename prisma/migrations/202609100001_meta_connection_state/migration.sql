ALTER TABLE "meta_health_snapshots"
  ADD COLUMN "connection_state" TEXT NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "connection_observed_at" TIMESTAMPTZ(3),
  ADD COLUMN "connection_reason" TEXT;

-- Existing account events have no reliable ordering against a connection read.
-- Leave UNKNOWN until a fresh Graph query or verified lifecycle webhook arrives.
ALTER TABLE "meta_health_snapshots" ADD CONSTRAINT "MetaHealthSnapshot_connection_state_check"
  CHECK ("connection_state" IN ('UNKNOWN', 'CONNECTED', 'DISCONNECTED'));
