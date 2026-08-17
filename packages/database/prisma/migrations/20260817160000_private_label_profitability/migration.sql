CREATE TYPE "PrivateLabelIncoterm" AS ENUM ('EXW', 'FOB', 'DDP');
CREATE TYPE "PrivateLabelCostCategory" AS ENUM ('SAMPLES', 'TOOLING_SETUP', 'PACKAGING', 'LABELING', 'INSPECTION', 'FREIGHT', 'CUSTOMS_TARIFFS', 'INSURANCE', 'PREP', 'INBOUND_SHIPPING', 'AMAZON_REFERRAL', 'AMAZON_FBA', 'STORAGE_ALLOWANCE', 'RETURNS_ALLOWANCE', 'AD_LAUNCH_BUDGET', 'COUPON_PROMO', 'DEFECT_ALLOWANCE');
CREATE TYPE "PrivateLabelCostAllocation" AS ENUM ('PER_UNIT', 'BATCH_TOTAL', 'PERCENT_OF_PRICE');
CREATE TYPE "PrivateLabelCostConfidence" AS ENUM ('CONFIRMED', 'ESTIMATED', 'UNKNOWN');
CREATE TYPE "PrivateLabelResultKind" AS ENUM ('BASE', 'STRESS');
CREATE TYPE "PrivateLabelResultStatus" AS ENUM ('CALCULATED', 'BLOCKED_MISSING_COST', 'BLOCKED_INVALID_INPUT');

CREATE TABLE "private_label_quote_scenarios" (
  "id" TEXT NOT NULL, "organization_id" TEXT NOT NULL, "project_id" TEXT NOT NULL,
  "name" TEXT NOT NULL, "version" INTEGER NOT NULL, "incoterm" "PrivateLabelIncoterm" NOT NULL,
  "supplier_currency" TEXT NOT NULL, "analysis_currency" TEXT NOT NULL,
  "unit_cost" DECIMAL(18,4) NOT NULL, "unit_cost_source" TEXT NOT NULL,
  "unit_cost_assumed_at" TIMESTAMP(3) NOT NULL, "moq" INTEGER NOT NULL,
  "target_selling_price" DECIMAL(18,4) NOT NULL, "target_price_source" TEXT NOT NULL,
  "target_price_assumed_at" TIMESTAMP(3) NOT NULL, "fx_rate" DECIMAL(20,10),
  "fx_source" TEXT, "fx_observed_at" TIMESTAMP(3), "formula_version" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "private_label_quote_scenarios_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "private_label_quote_scenarios_version" ON "private_label_quote_scenarios"("organization_id", "project_id", "name", "version");
CREATE INDEX "private_label_quote_scenarios_project" ON "private_label_quote_scenarios"("organization_id", "project_id", "updated_at");
ALTER TABLE "private_label_quote_scenarios" ADD CONSTRAINT "private_label_quote_scenarios_org" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "private_label_quote_scenarios" ADD CONSTRAINT "private_label_quote_scenarios_project" FOREIGN KEY ("project_id", "organization_id") REFERENCES "research_projects"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "private_label_cost_assumptions" (
  "id" TEXT NOT NULL, "organization_id" TEXT NOT NULL, "scenario_id" TEXT NOT NULL,
  "category" "PrivateLabelCostCategory" NOT NULL, "allocation" "PrivateLabelCostAllocation" NOT NULL,
  "amount" DECIMAL(18,4), "currency" TEXT NOT NULL, "source" TEXT NOT NULL,
  "assumed_at" TIMESTAMP(3) NOT NULL, "confidence" "PrivateLabelCostConfidence" NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "private_label_cost_assumptions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "private_label_cost_assumptions_category" ON "private_label_cost_assumptions"("scenario_id", "category");
CREATE INDEX "private_label_cost_assumptions_scenario" ON "private_label_cost_assumptions"("organization_id", "scenario_id");
ALTER TABLE "private_label_cost_assumptions" ADD CONSTRAINT "private_label_cost_assumptions_org" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "private_label_cost_assumptions" ADD CONSTRAINT "private_label_cost_assumptions_scenario" FOREIGN KEY ("scenario_id") REFERENCES "private_label_quote_scenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "private_label_scenario_results" (
  "id" TEXT NOT NULL, "organization_id" TEXT NOT NULL, "scenario_id" TEXT NOT NULL,
  "kind" "PrivateLabelResultKind" NOT NULL, "stress_name" TEXT NOT NULL,
  "status" "PrivateLabelResultStatus" NOT NULL, "formula_version" TEXT NOT NULL,
  "currency" TEXT NOT NULL, "landed_cost_per_unit" DECIMAL(18,4),
  "contribution_margin_per_unit" DECIMAL(18,4), "net_profit_per_unit" DECIMAL(18,4),
  "roi_percent" DECIMAL(12,4), "margin_percent" DECIMAL(12,4),
  "break_even_sale_price" DECIMAL(18,4), "break_even_ad_spend_per_unit" DECIMAL(18,4),
  "break_even_acos_percent" DECIMAL(12,4), "initial_cash_required" DECIMAL(20,4),
  "moq_cash_exposure" DECIMAL(20,4), "waterfall" JSONB NOT NULL,
  "uncertain_costs" JSONB NOT NULL, "reason_codes" JSONB NOT NULL,
  "input_snapshot" JSONB NOT NULL, "calculated_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "private_label_scenario_results_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "private_label_scenario_results_kind" ON "private_label_scenario_results"("scenario_id", "kind", "stress_name");
CREATE INDEX "private_label_scenario_results_scenario" ON "private_label_scenario_results"("organization_id", "scenario_id", "calculated_at");
ALTER TABLE "private_label_scenario_results" ADD CONSTRAINT "private_label_scenario_results_org" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "private_label_scenario_results" ADD CONSTRAINT "private_label_scenario_results_scenario" FOREIGN KEY ("scenario_id") REFERENCES "private_label_quote_scenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
