-- CreateTable
CREATE TABLE "contact_types" (
    "id" UUID NOT NULL,
    "display_name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "contact_types_color_check" CHECK ("color" ~ '^#[0-9A-F]{6}$'),
    CONSTRAINT "contact_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_tag_definitions" (
    "id" UUID NOT NULL,
    "display_name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "contact_tag_definitions_color_check" CHECK ("color" ~ '^#[0-9A-F]{6}$'),
    CONSTRAINT "contact_tag_definitions_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "contacts"
  ADD COLUMN "preferred_name" TEXT,
  ADD COLUMN "contact_type_id" UUID;

-- CreateTable
CREATE TABLE "contact_tag_assignments" (
    "contact_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_tag_assignments_pkey" PRIMARY KEY ("contact_id", "tag_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contact_types_normalized_name_key"
  ON "contact_types"("normalized_name");

-- CreateIndex
CREATE INDEX "contact_types_active_position_idx"
  ON "contact_types"("active", "position");

-- CreateIndex
CREATE UNIQUE INDEX "contact_tag_definitions_normalized_name_key"
  ON "contact_tag_definitions"("normalized_name");

-- CreateIndex
CREATE INDEX "contact_tag_definitions_active_position_idx"
  ON "contact_tag_definitions"("active", "position");

-- CreateIndex
CREATE INDEX "contact_tag_assignments_tag_id_contact_id_idx"
  ON "contact_tag_assignments"("tag_id", "contact_id");

-- AddForeignKey
ALTER TABLE "contacts"
  ADD CONSTRAINT "contacts_contact_type_id_fkey"
    FOREIGN KEY ("contact_type_id") REFERENCES "contact_types"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_tag_assignments"
  ADD CONSTRAINT "contact_tag_assignments_contact_id_fkey"
    FOREIGN KEY ("contact_id") REFERENCES "contacts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_tag_assignments"
  ADD CONSTRAINT "contact_tag_assignments_tag_id_fkey"
    FOREIGN KEY ("tag_id") REFERENCES "contact_tag_definitions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- SeedDefaults
INSERT INTO "contact_types" (
  "id", "display_name", "normalized_name", "color", "position", "active", "updated_at"
) VALUES
  ('10000000-0000-4000-8000-000000000001', 'Cliente', 'cliente', '#176B52', 10, true, CURRENT_TIMESTAMP),
  ('10000000-0000-4000-8000-000000000002', 'Interessado', 'interessado', '#2563EB', 20, true, CURRENT_TIMESTAMP),
  ('10000000-0000-4000-8000-000000000003', 'Fornecedor/Parceiro', 'fornecedor/parceiro', '#B7791F', 30, true, CURRENT_TIMESTAMP),
  ('10000000-0000-4000-8000-000000000004', 'Não cliente', 'não cliente', '#6D746F', 40, true, CURRENT_TIMESTAMP)
ON CONFLICT ("normalized_name") DO NOTHING;
