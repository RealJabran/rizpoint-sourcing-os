CREATE TYPE "PortfolioOptimizationStatus" AS ENUM ('CALCULATED', 'PARTIAL_SUCCESS', 'NO_FEASIBLE_PORTFOLIO', 'SOLVER_FAILED', 'INVALID_INPUT');
CREATE TYPE "PortfolioOptimizationScenario" AS ENUM ('BASE', 'DEMAND_DOWN_20', 'PRICE_DOWN_10', 'FEE_UP_5', 'DELAYED_REPLENISHMENT', 'AD_COST_INCREASE');

CREATE TABLE "portfolio_optimization_runs" (
  "id" TEXT NOT NULL, "organization_id" TEXT NOT NULL, "project_id" TEXT NOT NULL,
  "name" TEXT NOT NULL, "status" "PortfolioOptimizationStatus" NOT NULL,
  "solver_version" TEXT NOT NULL, "input_hash" TEXT NOT NULL,
  "currency" TEXT NOT NULL, "cash_budget" DECIMAL(20,4) NOT NULL,
  "constraints" JSONB NOT NULL, "stress_assumptions" JSONB NOT NULL,
  "input_snapshot" JSONB NOT NULL, "reason_codes" JSONB NOT NULL,
  "calculated_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "portfolio_optimization_runs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "portfolio_optimization_runs_input" ON "portfolio_optimization_runs"("organization_id", "project_id", "input_hash");
CREATE UNIQUE INDEX "portfolio_optimization_runs_id_org" ON "portfolio_optimization_runs"("id", "organization_id");
CREATE INDEX "portfolio_optimization_runs_project" ON "portfolio_optimization_runs"("organization_id", "project_id", "calculated_at");
ALTER TABLE "portfolio_optimization_runs" ADD CONSTRAINT "portfolio_optimization_runs_org" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "portfolio_optimization_runs" ADD CONSTRAINT "portfolio_optimization_runs_project" FOREIGN KEY ("project_id", "organization_id") REFERENCES "research_projects"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "portfolio_optimization_results" (
  "id" TEXT NOT NULL, "organization_id" TEXT NOT NULL, "run_id" TEXT NOT NULL,
  "scenario" "PortfolioOptimizationScenario" NOT NULL, "rank" INTEGER NOT NULL,
  "status" "PortfolioOptimizationStatus" NOT NULL,
  "exact_optimal" BOOLEAN NOT NULL, "search_nodes" INTEGER NOT NULL,
  "cash_used" DECIMAL(20,4), "cash_remaining" DECIMAL(20,4),
  "expected_profit_low" DECIMAL(20,4), "expected_profit_high" DECIMAL(20,4),
  "product_count" INTEGER, "diversification_score" DECIMAL(12,4),
  "risk_concentration" JSONB NOT NULL, "constraint_audit" JSONB NOT NULL,
  "excluded_products" JSONB NOT NULL, "assumptions" JSONB NOT NULL,
  "reason_codes" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "portfolio_optimization_results_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "portfolio_optimization_results_scenario_rank" ON "portfolio_optimization_results"("run_id", "scenario", "rank");
CREATE UNIQUE INDEX "portfolio_optimization_results_id_org" ON "portfolio_optimization_results"("id", "organization_id");
CREATE INDEX "portfolio_optimization_results_run" ON "portfolio_optimization_results"("organization_id", "run_id", "scenario", "rank");
ALTER TABLE "portfolio_optimization_results" ADD CONSTRAINT "portfolio_optimization_results_org" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "portfolio_optimization_results" ADD CONSTRAINT "portfolio_optimization_results_run_org" FOREIGN KEY ("run_id", "organization_id") REFERENCES "portfolio_optimization_runs"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "portfolio_allocations" (
  "id" TEXT NOT NULL, "organization_id" TEXT NOT NULL, "result_id" TEXT NOT NULL,
  "catalog_product_id" TEXT NOT NULL, "candidate_key" TEXT NOT NULL,
  "asin" TEXT NOT NULL, "brand" TEXT NOT NULL, "category" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL, "case_pack" INTEGER NOT NULL, "moq" INTEGER NOT NULL,
  "unit_cost" DECIMAL(18,4) NOT NULL, "cash_allocated" DECIMAL(20,4) NOT NULL,
  "expected_profit_low" DECIMAL(20,4) NOT NULL,
  "expected_profit_high" DECIMAL(20,4) NOT NULL,
  "expected_units_sold_low" DECIMAL(20,4) NOT NULL,
  "expected_units_sold_high" DECIMAL(20,4) NOT NULL,
  "coverage_days" INTEGER NOT NULL, "evidence_references" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "portfolio_allocations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "portfolio_allocations_candidate" ON "portfolio_allocations"("result_id", "candidate_key");
CREATE INDEX "portfolio_allocations_result" ON "portfolio_allocations"("organization_id", "result_id");
CREATE INDEX "portfolio_allocations_product" ON "portfolio_allocations"("organization_id", "catalog_product_id");
ALTER TABLE "portfolio_allocations" ADD CONSTRAINT "portfolio_allocations_org" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "portfolio_allocations" ADD CONSTRAINT "portfolio_allocations_result_org" FOREIGN KEY ("result_id", "organization_id") REFERENCES "portfolio_optimization_results"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portfolio_allocations" ADD CONSTRAINT "portfolio_allocations_product" FOREIGN KEY ("catalog_product_id") REFERENCES "catalog_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
