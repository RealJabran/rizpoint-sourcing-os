ALTER TABLE "outbox_events"
DROP CONSTRAINT IF EXISTS "outbox_events_one_aggregate";

ALTER TABLE "outbox_events"
ADD CONSTRAINT "outbox_events_one_aggregate" CHECK (
  ("scan_job_id" IS NOT NULL)::int +
  ("export_job_id" IS NOT NULL)::int +
  ("provider_connection_job_id" IS NOT NULL)::int = 1
);
