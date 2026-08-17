CREATE TYPE "SalesEstimationModelStatus" AS ENUM ('DRAFT', 'VALIDATED', 'RETIRED');
CREATE TYPE "SalesEstimateSource" AS ENUM ('LICENSED_PROVIDER', 'RIZPOINT_CALIBRATED_MODEL');
CREATE TABLE "sales_estimation_models" (
  "id" TEXT NOT NULL, "organization_id" TEXT NOT NULL, "marketplace_id" TEXT NOT NULL, "category_reference" TEXT NOT NULL, "version" TEXT NOT NULL,
  "status" "SalesEstimationModelStatus" NOT NULL, "reference_dataset_id" TEXT NOT NULL, "reference_dataset_source" TEXT NOT NULL, "reference_sample_size" INTEGER NOT NULL,
  "parameters" JSONB NOT NULL, "evaluation_metrics" JSONB NOT NULL, "validated_at" TIMESTAMP(3), "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sales_estimation_models_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "sales_estimation_models" ADD CONSTRAINT "sales_estimation_models_reference_sample_check" CHECK ("reference_sample_size" > 0);
CREATE TABLE "sales_estimates" (
  "id" TEXT NOT NULL, "organization_id" TEXT NOT NULL, "catalog_product_id" TEXT NOT NULL, "marketplace_id" TEXT NOT NULL, "category_reference" TEXT,
  "source" "SalesEstimateSource" NOT NULL, "monthly_units_low" DECIMAL(20,4) NOT NULL, "monthly_units_central" DECIMAL(20,4), "monthly_units_high" DECIMAL(20,4) NOT NULL,
  "confidence_percent" DECIMAL(9,4), "provider_key" TEXT, "model_id" TEXT, "model_version" TEXT NOT NULL, "input_fingerprint" TEXT NOT NULL,
  "input_evidence_references" JSONB NOT NULL, "observed_at" TIMESTAMP(3) NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sales_estimates_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "sales_estimates" ADD CONSTRAINT "sales_estimates_range_check" CHECK (
  "monthly_units_low" >= 0 AND "monthly_units_high" >= "monthly_units_low"
  AND ("monthly_units_central" IS NULL OR ("monthly_units_central" >= "monthly_units_low" AND "monthly_units_central" <= "monthly_units_high"))
  AND ("confidence_percent" IS NULL OR ("confidence_percent" >= 0 AND "confidence_percent" <= 100))
);
ALTER TABLE "sales_estimates" ADD CONSTRAINT "sales_estimates_source_lineage_check" CHECK (
  ("source" = 'LICENSED_PROVIDER' AND "provider_key" IS NOT NULL AND "model_id" IS NULL)
  OR ("source" = 'RIZPOINT_CALIBRATED_MODEL' AND "provider_key" IS NULL AND "model_id" IS NOT NULL)
);
CREATE UNIQUE INDEX "sales_estimation_models_org_market_category_version_key" ON "sales_estimation_models"("organization_id", "marketplace_id", "category_reference", "version");
CREATE INDEX "sales_estimation_models_lookup_idx" ON "sales_estimation_models"("organization_id", "marketplace_id", "category_reference", "status");
CREATE UNIQUE INDEX "sales_estimates_input_key" ON "sales_estimates"("organization_id", "catalog_product_id", "source", "model_version", "input_fingerprint");
CREATE INDEX "sales_estimates_org_product_observed_idx" ON "sales_estimates"("organization_id", "catalog_product_id", "observed_at");
CREATE INDEX "sales_estimates_model_id_idx" ON "sales_estimates"("model_id");
ALTER TABLE "sales_estimation_models" ADD CONSTRAINT "sales_estimation_models_organization_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_estimates" ADD CONSTRAINT "sales_estimates_organization_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_estimates" ADD CONSTRAINT "sales_estimates_catalog_product_fkey" FOREIGN KEY ("catalog_product_id") REFERENCES "catalog_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_estimates" ADD CONSTRAINT "sales_estimates_model_fkey" FOREIGN KEY ("model_id") REFERENCES "sales_estimation_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
