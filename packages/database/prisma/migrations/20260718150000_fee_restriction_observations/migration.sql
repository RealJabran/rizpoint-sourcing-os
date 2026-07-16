CREATE TYPE "FeeScenarioSource" AS ENUM (
  'CURRENT_FEATURED_OFFER',
  'CONSERVATIVE',
  'USER_ENTERED'
);

CREATE TYPE "ListingRestrictionState" AS ENUM (
  'ELIGIBLE',
  'RESTRICTED',
  'APPROVAL_REQUIRED',
  'INCOMPLETE',
  'UNAUTHORIZED',
  'THROTTLED',
  'UNKNOWN'
);

ALTER TABLE "provider_observations"
  ADD COLUMN "fee_scenario_source" "FeeScenarioSource",
  ADD COLUMN "fee_fulfillment" "OfferFulfillmentChannel",
  ADD COLUMN "restriction_state" "ListingRestrictionState",
  ADD COLUMN "restriction_reason_codes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "restriction_reasons" JSONB,
  ADD COLUMN "restriction_condition_type" TEXT;

ALTER TABLE "profit_results"
  ADD COLUMN "current_proceeds" DECIMAL(18,4),
  ADD COLUMN "user_entered_net_profit" DECIMAL(18,4);

ALTER TABLE "profit_cost_overrides"
  ADD COLUMN "user_entered_sale_price" DECIMAL(18,4);

UPDATE "financial_policies"
SET "engine_version" = 'profit-engine/v3'
WHERE "engine_version" = 'profit-engine/v2';

CREATE TABLE "provider_fee_components" (
  "id" TEXT NOT NULL,
  "provider_observation_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "fee_type" TEXT NOT NULL,
  "parent_fee_type" TEXT,
  "currency" TEXT NOT NULL,
  "fee_amount" DECIMAL(18,4) NOT NULL,
  "promotion_amount" DECIMAL(18,4),
  "tax_amount" DECIMAL(18,4),
  "final_fee" DECIMAL(18,4) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "provider_fee_components_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "provider_fee_components_provider_observation_id_fkey"
    FOREIGN KEY ("provider_observation_id")
    REFERENCES "provider_observations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "provider_fee_components_provider_observation_id_ordinal_key"
  ON "provider_fee_components"("provider_observation_id", "ordinal");
CREATE INDEX "provider_fee_components_provider_observation_id_fee_type_idx"
  ON "provider_fee_components"("provider_observation_id", "fee_type");
CREATE INDEX "provider_observations_metric_type_completeness_idx"
  ON "provider_observations"("metric_type", "completeness");
CREATE INDEX "provider_observations_metric_type_restriction_state_idx"
  ON "provider_observations"("metric_type", "restriction_state");
