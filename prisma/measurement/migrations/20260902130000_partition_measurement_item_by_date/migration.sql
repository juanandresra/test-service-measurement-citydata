-- 1. Si existe measurement_item como tabla no particionada, renombrarla a measurement_item_old
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_tables 
    WHERE schemaname = 'public' AND tablename = 'measurement_item'
  ) THEN
    ALTER TABLE "measurement_item" DROP CONSTRAINT IF EXISTS "measurement_item_measurement_id_fkey";
    ALTER TABLE "measurement_item" RENAME TO "measurement_item_old";
  END IF;
END $$;

-- 2. Renombrar los índices de measurement_item_old para liberar los nombres para la nueva tabla
ALTER INDEX IF EXISTS "measurement_item_pkey" RENAME TO "measurement_item_old_pkey";
ALTER INDEX IF EXISTS "measurement_item_measurement_id_idx" RENAME TO "measurement_item_old_measurement_id_idx";
ALTER INDEX IF EXISTS "measurement_item_organization_id_campaign_id_resolved_at_idx" RENAME TO "measurement_item_old_organization_id_campaign_id_resolved_at_idx";
ALTER INDEX IF EXISTS "measurement_item_campaign_id_user_id_resolved_at_idx" RENAME TO "measurement_item_old_campaign_id_user_id_resolved_at_idx";
ALTER INDEX IF EXISTS "measurement_item_organization_id_resolved_at_idx" RENAME TO "measurement_item_old_organization_id_resolved_at_idx";
ALTER INDEX IF EXISTS "measurement_item_resolved_at_idx" RENAME TO "measurement_item_old_resolved_at_idx";

-- 3. Crear la nueva tabla maestra particionada por RANGE (resolved_at)
CREATE TABLE IF NOT EXISTS "measurement_item" (
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
    "resolved_source" VARCHAR(20) NOT NULL DEFAULT 'server',
    "meta_location" JSONB,
    "meta_timestamps" JSONB,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "measurement_item_pkey" PRIMARY KEY ("id", "resolved_at")
) PARTITION BY RANGE ("resolved_at");

-- 4. Partición DEFAULT de salvaguarda
CREATE TABLE IF NOT EXISTS "measurement_item_default"
    PARTITION OF "measurement_item" DEFAULT;

-- 5. Particiones año 2026
CREATE TABLE IF NOT EXISTS "measurement_item_2026_01"
    PARTITION OF "measurement_item"
    FOR VALUES FROM ('2026-01-01 00:00:00') TO ('2026-02-01 00:00:00');

CREATE TABLE IF NOT EXISTS "measurement_item_2026_02"
    PARTITION OF "measurement_item"
    FOR VALUES FROM ('2026-02-01 00:00:00') TO ('2026-03-01 00:00:00');

CREATE TABLE IF NOT EXISTS "measurement_item_2026_03"
    PARTITION OF "measurement_item"
    FOR VALUES FROM ('2026-03-01 00:00:00') TO ('2026-04-01 00:00:00');

CREATE TABLE IF NOT EXISTS "measurement_item_2026_04"
    PARTITION OF "measurement_item"
    FOR VALUES FROM ('2026-04-01 00:00:00') TO ('2026-05-01 00:00:00');

CREATE TABLE IF NOT EXISTS "measurement_item_2026_05"
    PARTITION OF "measurement_item"
    FOR VALUES FROM ('2026-05-01 00:00:00') TO ('2026-06-01 00:00:00');

CREATE TABLE IF NOT EXISTS "measurement_item_2026_06"
    PARTITION OF "measurement_item"
    FOR VALUES FROM ('2026-06-01 00:00:00') TO ('2026-07-01 00:00:00');

CREATE TABLE IF NOT EXISTS "measurement_item_2026_07"
    PARTITION OF "measurement_item"
    FOR VALUES FROM ('2026-07-01 00:00:00') TO ('2026-08-01 00:00:00');

CREATE TABLE IF NOT EXISTS "measurement_item_2026_08"
    PARTITION OF "measurement_item"
    FOR VALUES FROM ('2026-08-01 00:00:00') TO ('2026-09-01 00:00:00');

CREATE TABLE IF NOT EXISTS "measurement_item_2026_09"
    PARTITION OF "measurement_item"
    FOR VALUES FROM ('2026-09-01 00:00:00') TO ('2026-10-01 00:00:00');

CREATE TABLE IF NOT EXISTS "measurement_item_2026_10"
    PARTITION OF "measurement_item"
    FOR VALUES FROM ('2026-10-01 00:00:00') TO ('2026-11-01 00:00:00');

CREATE TABLE IF NOT EXISTS "measurement_item_2026_11"
    PARTITION OF "measurement_item"
    FOR VALUES FROM ('2026-11-01 00:00:00') TO ('2026-12-01 00:00:00');

CREATE TABLE IF NOT EXISTS "measurement_item_2026_12"
    PARTITION OF "measurement_item"
    FOR VALUES FROM ('2026-12-01 00:00:00') TO ('2027-01-01 00:00:00');

-- 6. Recrear índices en la tabla maestra
CREATE INDEX IF NOT EXISTS "measurement_item_measurement_id_idx" ON "measurement_item"("measurement_id");
CREATE INDEX IF NOT EXISTS "measurement_item_organization_id_campaign_id_resolved_at_idx" ON "measurement_item"("organization_id", "campaign_id", "resolved_at");
CREATE INDEX IF NOT EXISTS "measurement_item_campaign_id_user_id_resolved_at_idx" ON "measurement_item"("campaign_id", "user_id", "resolved_at");
CREATE INDEX IF NOT EXISTS "measurement_item_organization_id_resolved_at_idx" ON "measurement_item"("organization_id", "resolved_at");
CREATE INDEX IF NOT EXISTS "measurement_item_resolved_at_idx" ON "measurement_item"("resolved_at");

-- 7. Recrear la foreign key hacia measurement
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'measurement_item_measurement_id_fkey'
  ) THEN
    ALTER TABLE "measurement_item" ADD CONSTRAINT "measurement_item_measurement_id_fkey" 
        FOREIGN KEY ("measurement_id") REFERENCES "measurement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- 8. Migrar todos los datos existentes de measurement_item_old a la nueva measurement_item
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'measurement_item_old') THEN
    INSERT INTO "measurement_item" (
        "id", "measurement_id", "organization_id", "research_id", "campaign_id", 
        "user_id", "answers", "latitude", "longitude", "resolved_at", 
        "resolved_source", "meta_location", "meta_timestamps", "deleted_at", "created_at"
    )
    SELECT 
        "id", "measurement_id", "organization_id", "research_id", "campaign_id", 
        "user_id", "answers", "latitude", "longitude", "resolved_at", 
        COALESCE("resolved_source", 'server'), "meta_location", "meta_timestamps", "deleted_at", "created_at"
    FROM "measurement_item_old";

    DROP TABLE "measurement_item_old";
  END IF;
END $$;
