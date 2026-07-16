ALTER TABLE "provider_observations"
  ADD COLUMN "observation_key" TEXT NOT NULL DEFAULT 'PRIMARY';

UPDATE "provider_observations"
SET "observation_key" = COALESCE("fee_scenario_source"::TEXT, 'CURRENT_FEATURED_OFFER')
WHERE "metric_type" = 'FEES';

DROP INDEX "provider_observations_enrichment_item_id_metric_type_provider_key";

CREATE UNIQUE INDEX "provider_observations_enrichment_item_id_metric_type_provider_observation_key_key"
  ON "provider_observations"(
    "enrichment_item_id",
    "metric_type",
    "provider",
    "observation_key"
  );
