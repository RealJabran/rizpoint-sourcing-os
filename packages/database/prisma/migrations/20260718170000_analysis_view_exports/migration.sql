ALTER TYPE "ExportKind" ADD VALUE IF NOT EXISTS 'ANALYSIS_VIEW';

ALTER TABLE "export_jobs"
  ADD COLUMN "scan_job_id" TEXT,
  ADD COLUMN "query_state" JSONB;

ALTER TABLE "export_jobs"
  ADD CONSTRAINT "export_jobs_scan_job_id_fkey"
  FOREIGN KEY ("scan_job_id") REFERENCES "scan_jobs"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "export_jobs_organization_id_scan_job_id_created_at_idx"
  ON "export_jobs"("organization_id", "scan_job_id", "created_at");
