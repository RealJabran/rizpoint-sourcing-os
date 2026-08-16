-- Prompt 04: additive, optional market-history refresh checkpoints. Historical
-- evidence is never required by the wholesale scan workflow.
ALTER TYPE "ResearchObservationType" ADD VALUE IF NOT EXISTS 'HISTORY';

CREATE TYPE "HistoryRefreshRunStatus" AS ENUM (
  'PENDING', 'RUNNING', 'COMPLETED', 'PARTIAL_SUCCESS',
  'FAILED_RETRYABLE', 'FAILED_FINAL'
);
CREATE TYPE "HistoryRefreshItemStatus" AS ENUM (
  'PENDING', 'COMPLETED', 'PARTIAL', 'UNAUTHORIZED', 'THROTTLED',
  'UNAVAILABLE', 'FAILED_RETRYABLE', 'FAILED_FINAL'
);

CREATE TABLE "history_refresh_runs" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "scan_job_id" TEXT NOT NULL,
  "provider_key" TEXT NOT NULL,
  "marketplace_id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "history_days" INTEGER NOT NULL DEFAULT 365,
  "status" "HistoryRefreshRunStatus" NOT NULL DEFAULT 'PENDING',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "missing_count" INTEGER NOT NULL DEFAULT 0,
  "error_code" TEXT,
  "retry_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "history_refresh_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "history_refresh_runs_days_check" CHECK ("history_days" > 0 AND "history_days" <= 730)
);

CREATE TABLE "history_refresh_items" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "history_refresh_run_id" TEXT NOT NULL,
  "asin" TEXT NOT NULL,
  "catalog_product_id" TEXT,
  "status" "HistoryRefreshItemStatus" NOT NULL DEFAULT 'PENDING',
  "observation_id" TEXT,
  "raw_evidence_reference" TEXT,
  "error_code" TEXT,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "history_refresh_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "history_refresh_items_asin_check" CHECK ("asin" ~ '^B[A-Z0-9]{9}$')
);

CREATE UNIQUE INDEX "history_refresh_runs_org_idempotency_key"
  ON "history_refresh_runs"("organization_id", "idempotency_key");
CREATE INDEX "history_refresh_runs_org_scan_status_updated_idx"
  ON "history_refresh_runs"("organization_id", "scan_job_id", "status", "updated_at");
CREATE UNIQUE INDEX "history_refresh_items_run_asin_key"
  ON "history_refresh_items"("history_refresh_run_id", "asin");
CREATE INDEX "history_refresh_items_org_status_updated_idx"
  ON "history_refresh_items"("organization_id", "status", "updated_at");
CREATE INDEX "history_refresh_items_catalog_product_idx"
  ON "history_refresh_items"("catalog_product_id");

ALTER TABLE "history_refresh_runs" ADD CONSTRAINT "history_refresh_runs_organization_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "history_refresh_runs" ADD CONSTRAINT "history_refresh_runs_scan_job_fkey"
  FOREIGN KEY ("scan_job_id") REFERENCES "scan_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "history_refresh_items" ADD CONSTRAINT "history_refresh_items_organization_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "history_refresh_items" ADD CONSTRAINT "history_refresh_items_run_fkey"
  FOREIGN KEY ("history_refresh_run_id") REFERENCES "history_refresh_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "history_refresh_items" ADD CONSTRAINT "history_refresh_items_catalog_product_fkey"
  FOREIGN KEY ("catalog_product_id") REFERENCES "catalog_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "history_refresh_items" ADD CONSTRAINT "history_refresh_items_observation_org_fkey"
  FOREIGN KEY ("observation_id", "organization_id") REFERENCES "research_observations"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
