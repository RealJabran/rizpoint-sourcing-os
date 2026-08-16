-- Prompt 05: derived history analytics are versioned snapshots. Raw provider
-- observations and normalized points remain immutable source evidence.
CREATE TYPE "HistoryAnalyticsStatus" AS ENUM (
  'COMPLETE', 'PARTIAL', 'INSUFFICIENT_DATA'
);

CREATE TABLE "history_analytics_assessments" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "catalog_product_id" TEXT NOT NULL,
  "marketplace_id" TEXT NOT NULL,
  "provider_key" TEXT NOT NULL,
  "calculation_version" TEXT NOT NULL,
  "input_fingerprint" TEXT NOT NULL,
  "status" "HistoryAnalyticsStatus" NOT NULL,
  "window_start" TIMESTAMP(3),
  "window_end" TIMESTAMP(3) NOT NULL,
  "coverage_percent" DECIMAL(9,4),
  "metrics" JSONB NOT NULL,
  "warnings" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "input_point_references" JSONB NOT NULL,
  "calculated_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "history_analytics_assessments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "history_analytics_assessments_input_key"
  ON "history_analytics_assessments" (
    "organization_id", "catalog_product_id", "marketplace_id", "provider_key",
    "calculation_version", "input_fingerprint"
  );
CREATE INDEX "history_analytics_assessments_org_product_calculated_idx"
  ON "history_analytics_assessments" (
    "organization_id", "catalog_product_id", "marketplace_id", "calculated_at"
  );
CREATE INDEX "history_analytics_assessments_catalog_product_id_idx"
  ON "history_analytics_assessments" ("catalog_product_id");

ALTER TABLE "history_analytics_assessments"
  ADD CONSTRAINT "history_analytics_assessments_organization_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "history_analytics_assessments"
  ADD CONSTRAINT "history_analytics_assessments_catalog_product_fkey"
  FOREIGN KEY ("catalog_product_id") REFERENCES "catalog_products"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
