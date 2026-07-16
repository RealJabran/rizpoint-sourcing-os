DROP INDEX IF EXISTS "export_jobs_organization_id_scan_job_id_created_at_idx";

ALTER TABLE "export_jobs"
  DROP CONSTRAINT IF EXISTS "export_jobs_scan_job_id_fkey",
  DROP COLUMN IF EXISTS "query_state",
  DROP COLUMN IF EXISTS "scan_job_id";

-- PostgreSQL enum values are intentionally not removed during rollback. Existing
-- rows must be archived or removed before downgrading code that cannot read
-- ANALYSIS_VIEW exports.
