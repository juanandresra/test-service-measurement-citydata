-- AlterTable
ALTER TABLE "measurement" ALTER COLUMN "body" DROP NOT NULL;

-- CreateTable
CREATE TABLE "measurement_item" (
    "id" VARCHAR(64) NOT NULL,
    "measurement_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "research_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "answers" JSONB NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "resolved_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "measurement_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "measurement_item_measurement_id_idx" ON "measurement_item"("measurement_id");

-- CreateIndex
CREATE INDEX "measurement_item_organization_id_campaign_id_resolved_at_idx" ON "measurement_item"("organization_id", "campaign_id", "resolved_at");

-- CreateIndex
CREATE INDEX "measurement_item_campaign_id_user_id_resolved_at_idx" ON "measurement_item"("campaign_id", "user_id", "resolved_at");

-- CreateIndex
CREATE INDEX "measurement_item_organization_id_resolved_at_idx" ON "measurement_item"("organization_id", "resolved_at");

-- CreateIndex
CREATE INDEX "measurement_item_resolved_at_idx" ON "measurement_item"("resolved_at");

-- AddForeignKey
ALTER TABLE "measurement_item" ADD CONSTRAINT "measurement_item_measurement_id_fkey" FOREIGN KEY ("measurement_id") REFERENCES "measurement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
