-- AlterTable
ALTER TABLE "measurement_item" ADD COLUMN "resolved_source" VARCHAR(20) NOT NULL DEFAULT 'server';
ALTER TABLE "measurement_item" ADD COLUMN "meta_location" JSONB;
ALTER TABLE "measurement_item" ADD COLUMN "meta_timestamps" JSONB;
