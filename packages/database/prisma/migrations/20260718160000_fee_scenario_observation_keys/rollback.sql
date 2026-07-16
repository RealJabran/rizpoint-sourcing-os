DROP INDEX IF EXISTS "provider_observations_enrichment_item_id_metric_type_provider_observation_key_key";

WITH ranked AS (
  SELECT "id",
         ROW_NUMBER() OVER (
           PARTITION BY "enrichment_item_id", "metric_type", "provider"
           ORDER BY "observed_at" DESC, "created_at" DESC, "id" DESC
         ) AS position
  FROM "provider_observations"
)
DELETE FROM "provider_observations"
WHERE "id" IN (SELECT "id" FROM ranked WHERE position > 1);

ALTER TABLE "provider_observations"
  DROP COLUMN IF EXISTS "observation_key";

CREATE UNIQUE INDEX "provider_observations_enrichment_item_id_metric_type_provider_key"
  ON "provider_observations"("enrichment_item_id", "metric_type", "provider");
