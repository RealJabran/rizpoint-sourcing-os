-- Remove analysis-view jobs only after deleting their private objects through
-- the normal retention/audit workflow. The original constraint cannot admit a
-- scan source.
DELETE FROM "export_jobs" WHERE "kind" = 'ANALYSIS_VIEW';

ALTER TABLE "export_jobs"
  DROP CONSTRAINT IF EXISTS "export_jobs_source";

ALTER TABLE "export_jobs"
  ADD CONSTRAINT "export_jobs_source"
  CHECK (("shortlist_id" IS NOT NULL)::int + ("purchase_order_id" IS NOT NULL)::int = 1);
