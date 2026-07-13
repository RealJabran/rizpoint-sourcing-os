-- Destructive rollback: take a backup before applying. It deletes Phase 5 saved
-- views, overrides, targeted calculation metadata, and the current-result projection.
DROP TABLE IF EXISTS "profit_calculation_targets";
DROP TABLE IF EXISTS "profit_cost_override_events";
DROP TABLE IF EXISTS "profit_cost_override_values";
DROP TABLE IF EXISTS "profit_cost_overrides";
DROP TABLE IF EXISTS "analysis_views";
DROP INDEX IF EXISTS "profit_results_one_current_per_row_route";
DROP INDEX IF EXISTS "profit_results_analysis_route_current_updated_idx";
DROP INDEX IF EXISTS "profit_results_analysis_recommendation_current_idx";
ALTER TABLE "profit_results"
  DROP CONSTRAINT IF EXISTS "profit_results_scan_job_id_fkey",
  DROP COLUMN IF EXISTS "applied_override_revision",
  DROP COLUMN IF EXISTS "is_current",
  DROP COLUMN IF EXISTS "scan_job_id";
ALTER TABLE "profit_calculation_runs"
  DROP COLUMN IF EXISTS "request_checksum",
  DROP COLUMN IF EXISTS "scope";
DROP TYPE IF EXISTS "CostOverrideField";
DROP TYPE IF EXISTS "AnalysisOverrideStatus";
DROP TYPE IF EXISTS "ProfitCalculationScope";
