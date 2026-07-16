CREATE TYPE "ProviderObservationStatus" AS ENUM ('SUCCESS', 'PARTIAL', 'UNAUTHORIZED', 'THROTTLED', 'RETRYABLE_FAILURE', 'TERMINAL_FAILURE', 'UNAVAILABLE');
CREATE TYPE "OfferPresence" AS ENUM ('PRESENT', 'ABSENT', 'UNKNOWN');
CREATE TYPE "OfferCompleteness" AS ENUM ('COMPLETE', 'PARTIAL', 'UNKNOWN');
CREATE TYPE "OfferFulfillmentChannel" AS ENUM ('AMAZON', 'MERCHANT', 'UNKNOWN');

ALTER TABLE "provider_observations"
  ADD COLUMN "operation" TEXT,
  ADD COLUMN "observation_status" "ProviderObservationStatus" NOT NULL DEFAULT 'SUCCESS',
  ADD COLUMN "request_hash" TEXT,
  ADD COLUMN "request_inputs" JSONB,
  ADD COLUMN "completeness" "OfferCompleteness",
  ADD COLUMN "raw_evidence_reference" TEXT,
  ADD COLUMN "asin" TEXT,
  ADD COLUMN "featured_offer_state" "OfferPresence",
  ADD COLUMN "featured_price" DECIMAL(18,4),
  ADD COLUMN "featured_currency" TEXT,
  ADD COLUMN "featured_fulfillment" "OfferFulfillmentChannel",
  ADD COLUMN "featured_seller_id" TEXT,
  ADD COLUMN "amazon_retail_presence" "OfferPresence",
  ADD COLUMN "visible_offer_count" INTEGER,
  ADD COLUMN "visible_offer_count_completeness" "OfferCompleteness",
  ADD COLUMN "fba_offer_count" INTEGER,
  ADD COLUMN "fba_offer_count_completeness" "OfferCompleteness",
  ADD COLUMN "fbm_offer_count" INTEGER,
  ADD COLUMN "fbm_offer_count_completeness" "OfferCompleteness",
  ADD COLUMN "lowest_fba_price" DECIMAL(18,4),
  ADD COLUMN "lowest_fbm_price" DECIMAL(18,4);

CREATE INDEX "provider_observations_metric_type_featured_offer_state_idx"
  ON "provider_observations"("metric_type", "featured_offer_state");
CREATE INDEX "provider_observations_metric_type_amazon_retail_presence_idx"
  ON "provider_observations"("metric_type", "amazon_retail_presence");
