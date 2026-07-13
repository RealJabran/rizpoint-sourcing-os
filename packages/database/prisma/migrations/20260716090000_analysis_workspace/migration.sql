-- Phase 5 is additive. Historical profit results remain immutable; `is_current`
-- is a fast, tenant-scoped projection for the analysis workspace.
CREATE TYPE "ProfitCalculationScope" AS ENUM ('FULL', 'TARGETED');
CREATE TYPE "AnalysisOverrideStatus" AS ENUM ('PENDING_RECALCULATION', 'APPLIED', 'FAILED');
CREATE TYPE "CostOverrideField" AS ENUM (
  'SUPPLIER_COST_PER_SELLABLE_UNIT', 'ALLOCATED_SUPPLIER_FREIGHT', 'PREP_FEE',
  'LABELING_FEE', 'POLYBAG_FEE', 'BUNDLE_FEE', 'BUBBLEWRAP_FEE',
  'INBOUND_SHIPPING', 'DUTY_OR_TAX', 'STORAGE_ALLOWANCE', 'RETURN_ALLOWANCE', 'OTHER_COSTS'
);

ALTER TABLE "profit_calculation_runs"
  ADD COLUMN "scope" "ProfitCalculationScope" NOT NULL DEFAULT 'FULL',
  ADD COLUMN "request_checksum" TEXT;

ALTER TABLE "profit_results"
  ADD COLUMN "scan_job_id" TEXT,
  ADD COLUMN "is_current" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "applied_override_revision" INTEGER;

UPDATE "profit_results" result
SET "scan_job_id" = run."scan_job_id"
FROM "profit_calculation_runs" run
WHERE result."profit_calculation_run_id" = run.id;

ALTER TABLE "profit_results"
  ALTER COLUMN "scan_job_id" SET NOT NULL,
  ADD CONSTRAINT "profit_results_scan_job_id_fkey"
    FOREIGN KEY ("scan_job_id") REFERENCES "scan_jobs"(id) ON DELETE CASCADE ON UPDATE CASCADE;

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY "organization_id", "scan_job_id", "supplier_row_id", "shipping_route_id"
    ORDER BY "updated_at" DESC, id DESC
  ) AS position
  FROM "profit_results"
)
UPDATE "profit_results" result
SET "is_current" = ranked.position = 1
FROM ranked
WHERE result.id = ranked.id;

CREATE UNIQUE INDEX "profit_results_one_current_per_row_route"
  ON "profit_results" ("organization_id", "scan_job_id", "supplier_row_id", "shipping_route_id")
  WHERE "is_current";
CREATE INDEX "profit_results_analysis_route_current_updated_idx"
  ON "profit_results" ("organization_id", "scan_job_id", "shipping_route_id", "is_current", "updated_at");
CREATE INDEX "profit_results_analysis_recommendation_current_idx"
  ON "profit_results" ("organization_id", "scan_job_id", "recommendation", "is_current");

CREATE TABLE "analysis_views" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "scan_job_id" TEXT,
  "name" TEXT NOT NULL,
  "schema_version" INTEGER NOT NULL DEFAULT 1,
  "query_state" JSONB NOT NULL,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "analysis_views_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "analysis_views_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "analysis_views_scan_job_id_fkey" FOREIGN KEY ("scan_job_id") REFERENCES "scan_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "analysis_views_organization_id_scan_job_id_name_key" ON "analysis_views"("organization_id", "scan_job_id", "name");
CREATE INDEX "analysis_views_organization_id_scan_job_id_updated_at_idx" ON "analysis_views"("organization_id", "scan_job_id", "updated_at");

CREATE TABLE "profit_cost_overrides" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "scan_job_id" TEXT NOT NULL,
  "supplier_row_id" TEXT NOT NULL,
  "shipping_route_id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "status" "AnalysisOverrideStatus" NOT NULL DEFAULT 'PENDING_RECALCULATION',
  "reason" TEXT NOT NULL,
  "stress_discount_percent" DECIMAL(12,4),
  "calculation_run_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "profit_cost_overrides_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "profit_cost_overrides_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "profit_cost_overrides_scan_job_id_fkey" FOREIGN KEY ("scan_job_id") REFERENCES "scan_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "profit_cost_overrides_supplier_row_id_fkey" FOREIGN KEY ("supplier_row_id") REFERENCES "supplier_rows"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "profit_cost_overrides_shipping_route_id_fkey" FOREIGN KEY ("shipping_route_id") REFERENCES "shipping_routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "profit_cost_overrides_calculation_run_id_fkey" FOREIGN KEY ("calculation_run_id") REFERENCES "profit_calculation_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "profit_cost_overrides_organization_id_supplier_row_id_shipping_route_id_key" ON "profit_cost_overrides"("organization_id", "supplier_row_id", "shipping_route_id");
CREATE INDEX "profit_cost_overrides_organization_id_scan_job_id_status_idx" ON "profit_cost_overrides"("organization_id", "scan_job_id", "status");

CREATE TABLE "profit_cost_override_values" (
  "id" TEXT NOT NULL,
  "override_id" TEXT NOT NULL,
  "field" "CostOverrideField" NOT NULL,
  "value" DECIMAL(18,4) NOT NULL,
  CONSTRAINT "profit_cost_override_values_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "profit_cost_override_values_override_id_fkey" FOREIGN KEY ("override_id") REFERENCES "profit_cost_overrides"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "profit_cost_override_values_override_id_field_key" ON "profit_cost_override_values"("override_id", "field");

CREATE TABLE "profit_cost_override_events" (
  "id" TEXT NOT NULL,
  "override_id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "previous_values" JSONB NOT NULL,
  "next_values" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "profit_cost_override_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "profit_cost_override_events_override_id_fkey" FOREIGN KEY ("override_id") REFERENCES "profit_cost_overrides"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "profit_cost_override_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "profit_cost_override_events_organization_id_idempotency_key_key" ON "profit_cost_override_events"("organization_id", "idempotency_key");
CREATE INDEX "profit_cost_override_events_override_id_revision_idx" ON "profit_cost_override_events"("override_id", "revision");

CREATE TABLE "profit_calculation_targets" (
  "id" TEXT NOT NULL,
  "profit_calculation_run_id" TEXT NOT NULL,
  "supplier_row_id" TEXT NOT NULL,
  "shipping_route_id" TEXT NOT NULL,
  CONSTRAINT "profit_calculation_targets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "profit_calculation_targets_profit_calculation_run_id_fkey" FOREIGN KEY ("profit_calculation_run_id") REFERENCES "profit_calculation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "profit_calculation_targets_supplier_row_id_fkey" FOREIGN KEY ("supplier_row_id") REFERENCES "supplier_rows"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "profit_calculation_targets_shipping_route_id_fkey" FOREIGN KEY ("shipping_route_id") REFERENCES "shipping_routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "profit_calculation_targets_profit_calculation_run_id_supplier_row_id_shipping_route_id_key" ON "profit_calculation_targets"("profit_calculation_run_id", "supplier_row_id", "shipping_route_id");
