-- Manual rollback. Do not run in production without a backup; this deletes Phase 4 policies and audited financial results.
DROP TABLE "profit_results", "profit_calculation_runs", "brand_policies", "shipping_routes", "financial_policies";
ALTER TABLE "provider_observations" DROP COLUMN "quoted_price";
DROP TYPE "ProductRecommendation", "ProfitScenarioType", "ProfitCalculationStatus", "BrandPolicyStatus";
UPDATE "scan_jobs" SET "status" = 'COMPLETED' WHERE "status"::text = 'CALCULATING';
CREATE TYPE "ScanJobStatus_phase_three" AS ENUM ('UPLOADED', 'MAPPING_REQUIRED', 'READY', 'NORMALIZING', 'MATCHING', 'ENRICHING', 'QUEUED', 'RUNNING', 'COMPLETED', 'PARTIAL_SUCCESS', 'FAILED_RETRYABLE', 'FAILED_FINAL');
ALTER TABLE "scan_jobs" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "scan_jobs" ALTER COLUMN "status" TYPE "ScanJobStatus_phase_three" USING "status"::text::"ScanJobStatus_phase_three";
DROP TYPE "ScanJobStatus";
ALTER TYPE "ScanJobStatus_phase_three" RENAME TO "ScanJobStatus";
ALTER TABLE "scan_jobs" ALTER COLUMN "status" SET DEFAULT 'QUEUED';
