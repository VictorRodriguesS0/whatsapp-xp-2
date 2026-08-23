ALTER TABLE "conversations"
ADD COLUMN "pinned_at" TIMESTAMPTZ(3);

CREATE INDEX "conversations_pinned_queue_idx"
ON "conversations"("pinned_at" DESC, "last_message_at" DESC, "id" DESC);
