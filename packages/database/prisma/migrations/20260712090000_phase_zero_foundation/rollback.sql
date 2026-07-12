-- Manual rollback for local development or controlled recovery.
-- Review data-retention impact before running outside a disposable environment.
ALTER TABLE "outbox_events" DROP CONSTRAINT "outbox_events_scan_job_id_fkey";
ALTER TABLE "outbox_events" DROP CONSTRAINT "outbox_events_organization_id_fkey";
ALTER TABLE "scan_events" DROP CONSTRAINT "scan_events_scan_job_id_fkey";
ALTER TABLE "scan_checkpoints" DROP CONSTRAINT "scan_checkpoints_scan_job_id_fkey";
ALTER TABLE "scan_jobs" DROP CONSTRAINT "scan_jobs_organization_id_fkey";
DROP TABLE "outbox_events";
DROP TABLE "scan_events";
DROP TABLE "scan_checkpoints";
DROP TABLE "scan_jobs";
DROP TABLE "organizations";
DROP TYPE "OutboxStatus";
DROP TYPE "ScanJobStatus";
