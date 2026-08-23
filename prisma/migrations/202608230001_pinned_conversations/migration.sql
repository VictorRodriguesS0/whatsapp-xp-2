ALTER TABLE "conversations"
ADD COLUMN "pinned_at" TIMESTAMPTZ(3);

CREATE INDEX "conversations_pinned_queue_idx"
ON "conversations"("pinned_at" DESC NULLS LAST, "last_message_at" DESC, "id" DESC);
