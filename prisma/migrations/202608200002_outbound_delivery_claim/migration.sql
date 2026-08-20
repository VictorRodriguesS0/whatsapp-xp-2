ALTER TABLE "messages"
  ADD COLUMN "delivery_lease_id" UUID,
  ADD COLUMN "delivery_lease_until" TIMESTAMPTZ(3);

CREATE INDEX "messages_delivery_claim_idx"
  ON "messages"("status", "operational_state", "delivery_lease_until");
