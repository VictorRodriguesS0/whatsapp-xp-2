CREATE TABLE "quick_replies" (
    "id" UUID NOT NULL,
    "shortcut" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "quick_replies_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "quick_replies_shortcut_not_empty" CHECK (length(btrim("shortcut")) > 0),
    CONSTRAINT "quick_replies_message_not_empty" CHECK (length(btrim("message")) > 0)
);

CREATE UNIQUE INDEX "quick_replies_shortcut_key" ON "quick_replies"("shortcut");
CREATE INDEX "quick_replies_active_position_shortcut_idx" ON "quick_replies"("active", "position", "shortcut");
