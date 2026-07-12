-- Manual rollback. Do not run in production without a backup; this deletes Phase 1 upload data.
DELETE FROM "scan_jobs" WHERE "job_type" = 'UPLOAD';
ALTER TABLE "normalization_warnings" DROP CONSTRAINT "normalization_warnings_supplier_row_id_fkey";
ALTER TABLE "normalized_offers" DROP CONSTRAINT "normalized_offers_supplier_row_id_fkey";
ALTER TABLE "supplier_rows" DROP CONSTRAINT "supplier_rows_upload_sheet_id_fkey";
ALTER TABLE "supplier_rows" DROP CONSTRAINT "supplier_rows_scan_job_id_fkey";
ALTER TABLE "column_mappings" DROP CONSTRAINT "column_mappings_scan_job_id_fkey";
ALTER TABLE "sheet_profiles" DROP CONSTRAINT "sheet_profiles_supplier_id_fkey";
ALTER TABLE "sheet_profiles" DROP CONSTRAINT "sheet_profiles_organization_id_fkey";
ALTER TABLE "upload_sheets" DROP CONSTRAINT "upload_sheets_upload_id_fkey";
ALTER TABLE "uploads" DROP CONSTRAINT "uploads_supplier_id_fkey";
ALTER TABLE "uploads" DROP CONSTRAINT "uploads_organization_id_fkey";
ALTER TABLE "suppliers" DROP CONSTRAINT "suppliers_organization_id_fkey";
ALTER TABLE "scan_jobs" DROP CONSTRAINT "scan_jobs_upload_id_fkey";
ALTER TABLE "scan_jobs" DROP CONSTRAINT "scan_jobs_supplier_id_fkey";
DROP TABLE "normalization_warnings", "normalized_offers", "supplier_rows", "column_mappings", "sheet_profiles", "upload_sheets", "uploads", "suppliers";
ALTER TABLE "scan_jobs" DROP COLUMN "job_type", DROP COLUMN "upload_id", DROP COLUMN "supplier_id";
DROP TYPE "WarningSeverity", "NormalizationStatus", "MappingTarget", "FileFormat", "MalwareScanStatus", "UploadStatus";
CREATE TYPE "ScanJobStatus_phase_zero" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED_RETRYABLE', 'FAILED_FINAL');
ALTER TABLE "scan_jobs" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "scan_jobs"
  ALTER COLUMN "status" TYPE "ScanJobStatus_phase_zero"
  USING "status"::text::"ScanJobStatus_phase_zero";
DROP TYPE "ScanJobStatus";
ALTER TYPE "ScanJobStatus_phase_zero" RENAME TO "ScanJobStatus";
ALTER TABLE "scan_jobs" ALTER COLUMN "status" SET DEFAULT 'QUEUED';
