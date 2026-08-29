-- CreateTable
CREATE TABLE "measurement" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "research_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "form_version" VARCHAR(20) NOT NULL,
    "user_id" UUID NOT NULL,
    "header" JSONB NOT NULL,
    "body" JSONB NOT NULL,
    "meta" JSONB,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "measurement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "measurement_organization_id_idx" ON "measurement"("organization_id");

-- CreateIndex
CREATE INDEX "measurement_research_id_idx" ON "measurement"("research_id");

-- CreateIndex
CREATE INDEX "measurement_campaign_id_idx" ON "measurement"("campaign_id");

-- CreateIndex
CREATE INDEX "measurement_user_id_idx" ON "measurement"("user_id");

-- CreateIndex
CREATE INDEX "measurement_organization_id_campaign_id_deleted_at_idx" ON "measurement"("organization_id", "campaign_id", "deleted_at");

-- CreateIndex
CREATE INDEX "measurement_campaign_id_user_id_idx" ON "measurement"("campaign_id", "user_id");
