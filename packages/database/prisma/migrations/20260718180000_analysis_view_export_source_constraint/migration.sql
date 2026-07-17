ALTER TABLE "export_jobs"
  DROP CONSTRAINT "export_jobs_source";

ALTER TABLE "export_jobs"
  ADD CONSTRAINT "export_jobs_source"
  CHECK (
    ("shortlist_id" IS NOT NULL)::int +
    ("purchase_order_id" IS NOT NULL)::int +
    ("scan_job_id" IS NOT NULL)::int = 1
    AND
    (("kind" = 'ANALYSIS_VIEW') = ("scan_job_id" IS NOT NULL))
  );
