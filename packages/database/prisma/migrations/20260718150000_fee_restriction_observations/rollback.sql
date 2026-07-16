DROP INDEX IF EXISTS "provider_observations_metric_type_restriction_state_idx";
DROP INDEX IF EXISTS "provider_observations_metric_type_completeness_idx";
DROP TABLE IF EXISTS "provider_fee_components";

ALTER TABLE "profit_results"
  DROP COLUMN IF EXISTS "current_proceeds",
  DROP COLUMN IF EXISTS "user_entered_net_profit";

ALTER TABLE "profit_cost_overrides"
  DROP COLUMN IF EXISTS "user_entered_sale_price";

UPDATE "financial_policies"
SET "engine_version" = 'profit-engine/v2'
WHERE "engine_version" = 'profit-engine/v3';

ALTER TABLE "provider_observations"
  DROP COLUMN IF EXISTS "restriction_condition_type",
  DROP COLUMN IF EXISTS "restriction_reasons",
  DROP COLUMN IF EXISTS "restriction_reason_codes",
  DROP COLUMN IF EXISTS "restriction_state",
  DROP COLUMN IF EXISTS "fee_fulfillment",
  DROP COLUMN IF EXISTS "fee_scenario_source";

DROP TYPE IF EXISTS "ListingRestrictionState";
DROP TYPE IF EXISTS "FeeScenarioSource";
