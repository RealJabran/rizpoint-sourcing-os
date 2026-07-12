-- Manual rollback. Do not run in production without a backup; this deletes Phase 2 match history.
DROP TABLE "pack_guard_results", "match_decisions", "match_evidence", "listing_candidates", "match_lookups", "product_identifiers", "catalog_products";
ALTER TABLE "normalized_offers" DROP COLUMN "mpn";
DROP TYPE "PackGuardStatus", "ExternalFreshnessState", "LookupStatus", "DecisionSource", "MatchEvidenceOutcome", "MatchEvidenceFeature", "MatchDecisionStatus", "CandidateSource", "IdentifierType";

-- A Phase 2-only mapping is removed before recreating the Phase 1 enum.
DELETE FROM "column_mappings" WHERE "target"::text = 'MPN';
CREATE TYPE "MappingTarget_phase_one" AS ENUM ('ASIN', 'UPC', 'EAN', 'GTIN', 'ITEM_NUMBER', 'DESCRIPTION', 'BRAND', 'UNIT_COST', 'CURRENCY', 'QUANTITY', 'CASE_COUNT', 'PACK_COUNT', 'WEIGHT', 'LENGTH', 'WIDTH', 'HEIGHT');
ALTER TABLE "column_mappings" ALTER COLUMN "target" TYPE "MappingTarget_phase_one" USING "target"::text::"MappingTarget_phase_one";
DROP TYPE "MappingTarget";
ALTER TYPE "MappingTarget_phase_one" RENAME TO "MappingTarget";

-- An interrupted matching run is returned to its previously completed normalized state.
UPDATE "scan_jobs" SET "status" = 'COMPLETED' WHERE "status"::text = 'MATCHING';
CREATE TYPE "ScanJobStatus_phase_one" AS ENUM ('UPLOADED', 'MAPPING_REQUIRED', 'READY', 'NORMALIZING', 'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED_RETRYABLE', 'FAILED_FINAL');
ALTER TABLE "scan_jobs" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "scan_jobs" ALTER COLUMN "status" TYPE "ScanJobStatus_phase_one" USING "status"::text::"ScanJobStatus_phase_one";
DROP TYPE "ScanJobStatus";
ALTER TYPE "ScanJobStatus_phase_one" RENAME TO "ScanJobStatus";
ALTER TABLE "scan_jobs" ALTER COLUMN "status" SET DEFAULT 'QUEUED';
