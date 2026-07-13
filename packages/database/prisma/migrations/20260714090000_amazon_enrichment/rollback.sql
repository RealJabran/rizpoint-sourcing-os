-- Manual rollback. Do not run in production without a backup; this deletes Phase 3 connections and enrichment evidence.
DROP TABLE "provider_call_attempts", "provider_observations", "enrichment_items", "enrichment_runs", "provider_authorization_states", "provider_connections";
DROP TYPE "ProviderAttemptStatus", "EnrichmentMetricType", "EnrichmentItemStatus", "EnrichmentRunStatus", "ProviderConnectionStatus", "ProviderConnectionMode", "ProviderKind";
UPDATE "scan_jobs" SET "status" = 'COMPLETED' WHERE "status"::text IN ('ENRICHING', 'PARTIAL_SUCCESS');
CREATE TYPE "ScanJobStatus_phase_two" AS ENUM ('UPLOADED', 'MAPPING_REQUIRED', 'READY', 'NORMALIZING', 'MATCHING', 'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED_RETRYABLE', 'FAILED_FINAL');
ALTER TABLE "scan_jobs" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "scan_jobs" ALTER COLUMN "status" TYPE "ScanJobStatus_phase_two" USING "status"::text::"ScanJobStatus_phase_two";
DROP TYPE "ScanJobStatus";
ALTER TYPE "ScanJobStatus_phase_two" RENAME TO "ScanJobStatus";
ALTER TABLE "scan_jobs" ALTER COLUMN "status" SET DEFAULT 'QUEUED';
