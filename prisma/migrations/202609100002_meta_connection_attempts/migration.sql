CREATE TABLE "meta_connection_attempts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "phone_number_id" TEXT NOT NULL,
  "user_id" UUID NOT NULL,
  "session_hash" TEXT NOT NULL,
  "nonce_hash" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'WAITING',
  "code_hash" TEXT,
  "authorized_at" TIMESTAMPTZ(3),
  "session_info_at" TIMESTAMPTZ(3),
  "last_check_at" TIMESTAMPTZ(3),
  "check_lease_id" UUID,
  "check_lease_until" TIMESTAMPTZ(3),
  "error_code" TEXT,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "meta_connection_attempts_state_check" CHECK ("state" IN ('WAITING','EXCHANGING','VERIFYING','CONNECTED','FAILED','CANCELLED','EXPIRED'))
);
CREATE UNIQUE INDEX "meta_connection_attempts_code_hash_key" ON "meta_connection_attempts"("code_hash");
CREATE UNIQUE INDEX "meta_connection_attempts_one_active_phone" ON "meta_connection_attempts"("phone_number_id")
  WHERE "state" IN ('WAITING','EXCHANGING','VERIFYING');
CREATE INDEX "meta_connection_attempts_user_id_session_hash_created_at_idx" ON "meta_connection_attempts"("user_id","session_hash","created_at");
CREATE INDEX "meta_connection_attempts_expires_at_idx" ON "meta_connection_attempts"("expires_at");
