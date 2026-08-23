CREATE TABLE "whatsapp_app_contacts" (
    "id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "full_name" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "source_timestamp" TIMESTAMPTZ(3) NOT NULL,
    "source_version_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "whatsapp_app_contacts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "whatsapp_app_contacts_phone_key"
    ON "whatsapp_app_contacts"("phone");

CREATE INDEX "whatsapp_app_contacts_active_phone_idx"
    ON "whatsapp_app_contacts"("active", "phone");

ALTER TABLE "contacts"
    ADD COLUMN "whatsapp_app_contact_id" UUID;

CREATE UNIQUE INDEX "contacts_whatsapp_app_contact_id_key"
    ON "contacts"("whatsapp_app_contact_id");

ALTER TABLE "contacts"
    ADD CONSTRAINT "contacts_whatsapp_app_contact_id_fkey"
    FOREIGN KEY ("whatsapp_app_contact_id")
    REFERENCES "whatsapp_app_contacts"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;
