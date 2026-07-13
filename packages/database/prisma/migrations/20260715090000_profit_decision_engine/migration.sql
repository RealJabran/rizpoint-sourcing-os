-- Phase 4: auditable, tenant-scoped calculation policy, route, and result state.
ALTER TYPE "ScanJobStatus" ADD VALUE IF NOT EXISTS 'CALCULATING';

CREATE TYPE "BrandPolicyStatus" AS ENUM ('PROHIBITED', 'APPROVAL_REQUIRED', 'APPROVED', 'UNRESTRICTED');
CREATE TYPE "ProfitCalculationStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'PARTIAL_SUCCESS', 'FAILED_RETRYABLE', 'FAILED_FINAL');
CREATE TYPE "ProfitScenarioType" AS ENUM ('CURRENT', 'CONSERVATIVE', 'STRESS', 'MAP');
CREATE TYPE "ProductRecommendation" AS ENUM ('BUY', 'WATCH', 'REVIEW_MATCH', 'REVIEW_APPROVAL', 'REVIEW_COST', 'AVOID', 'INSUFFICIENT_DATA');

ALTER TABLE "provider_observations" ADD COLUMN "quoted_price" DECIMAL(18,4);

CREATE TABLE "financial_policies" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "engine_version" TEXT NOT NULL,
  "min_net_profit" DECIMAL(18,4) NOT NULL,
  "min_roi_percent" DECIMAL(12,4) NOT NULL,
  "min_margin_percent" DECIMAL(12,4) NOT NULL,
  "max_stress_loss" DECIMAL(18,4) NOT NULL,
  "stress_discount_percent" DECIMAL(12,4) NOT NULL,
  "minimum_demand_score" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "financial_policies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "shipping_routes" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "effective_from" TIMESTAMP(3) NOT NULL,
  "effective_to" TIMESTAMP(3),
  "allocated_supplier_freight" DECIMAL(18,4) NOT NULL,
  "prep_fee" DECIMAL(18,4) NOT NULL,
  "labeling_fee" DECIMAL(18,4) NOT NULL,
  "polybag_fee" DECIMAL(18,4) NOT NULL,
  "bundle_fee" DECIMAL(18,4) NOT NULL,
  "bubblewrap_fee" DECIMAL(18,4) NOT NULL,
  "inbound_shipping" DECIMAL(18,4) NOT NULL,
  "duty_or_tax" DECIMAL(18,4) NOT NULL,
  "storage_allowance" DECIMAL(18,4) NOT NULL,
  "return_allowance" DECIMAL(18,4) NOT NULL,
  "other_costs" DECIMAL(18,4) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "shipping_routes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "brand_policies" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "brand" TEXT NOT NULL,
  "status" "BrandPolicyStatus" NOT NULL,
  "approval_reference" TEXT,
  "expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "brand_policies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "profit_calculation_runs" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "scan_job_id" TEXT NOT NULL,
  "financial_policy_id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "status" "ProfitCalculationStatus" NOT NULL DEFAULT 'PENDING',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "profit_calculation_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "profit_results" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "profit_calculation_run_id" TEXT NOT NULL,
  "supplier_row_id" TEXT NOT NULL,
  "shipping_route_id" TEXT NOT NULL,
  "status" "ProfitCalculationStatus" NOT NULL,
  "recommendation" "ProductRecommendation",
  "scenario_type" "ProfitScenarioType" NOT NULL DEFAULT 'CURRENT',
  "current_net_profit" DECIMAL(18,4),
  "conservative_net_profit" DECIMAL(18,4),
  "stress_net_profit" DECIMAL(18,4),
  "effective_cogs" DECIMAL(18,4),
  "amazon_fees" DECIMAL(18,4),
  "roi_percent" DECIMAL(12,4),
  "margin_percent" DECIMAL(12,4),
  "break_even_price" DECIMAL(18,4),
  "engine_version" TEXT NOT NULL,
  "input_snapshot" JSONB NOT NULL,
  "evidence" JSONB NOT NULL,
  "reason_codes" JSONB NOT NULL,
  "overrides" JSONB NOT NULL DEFAULT '[]',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "profit_results_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "financial_policies_organization_id_key" ON "financial_policies"("organization_id");
CREATE UNIQUE INDEX "shipping_routes_organization_id_name_effective_from_key" ON "shipping_routes"("organization_id", "name", "effective_from");
CREATE INDEX "shipping_routes_organization_id_active_effective_from_idx" ON "shipping_routes"("organization_id", "active", "effective_from");
CREATE UNIQUE INDEX "brand_policies_organization_id_brand_key" ON "brand_policies"("organization_id", "brand");
CREATE INDEX "brand_policies_organization_id_status_idx" ON "brand_policies"("organization_id", "status");
CREATE UNIQUE INDEX "profit_calculation_runs_organization_id_idempotency_key_key" ON "profit_calculation_runs"("organization_id", "idempotency_key");
CREATE INDEX "profit_calculation_runs_organization_id_scan_job_id_status_idx" ON "profit_calculation_runs"("organization_id", "scan_job_id", "status");
CREATE UNIQUE INDEX "profit_results_profit_calculation_run_id_supplier_row_id_shipping_route_id_key" ON "profit_results"("profit_calculation_run_id", "supplier_row_id", "shipping_route_id");
CREATE INDEX "profit_results_organization_id_recommendation_updated_at_idx" ON "profit_results"("organization_id", "recommendation", "updated_at");

ALTER TABLE "financial_policies" ADD CONSTRAINT "financial_policies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shipping_routes" ADD CONSTRAINT "shipping_routes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "brand_policies" ADD CONSTRAINT "brand_policies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "profit_calculation_runs" ADD CONSTRAINT "profit_calculation_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "profit_calculation_runs" ADD CONSTRAINT "profit_calculation_runs_scan_job_id_fkey" FOREIGN KEY ("scan_job_id") REFERENCES "scan_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "profit_calculation_runs" ADD CONSTRAINT "profit_calculation_runs_financial_policy_id_fkey" FOREIGN KEY ("financial_policy_id") REFERENCES "financial_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "profit_results" ADD CONSTRAINT "profit_results_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "profit_results" ADD CONSTRAINT "profit_results_profit_calculation_run_id_fkey" FOREIGN KEY ("profit_calculation_run_id") REFERENCES "profit_calculation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "profit_results" ADD CONSTRAINT "profit_results_supplier_row_id_fkey" FOREIGN KEY ("supplier_row_id") REFERENCES "supplier_rows"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "profit_results" ADD CONSTRAINT "profit_results_shipping_route_id_fkey" FOREIGN KEY ("shipping_route_id") REFERENCES "shipping_routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
