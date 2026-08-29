-- Prompt 36J: payload-free Amazon Information deletion requests, durable
-- restoration tombstones, and retention run evidence.

CREATE TYPE "AmazonDeletionRequestReason" AS ENUM (
  'AMAZON_NOTICE', 'AUTHORIZATION_REVOKED', 'ENTITLEMENT_LOST',
  'SERVICE_TERMINATION', 'OPERATOR_POLICY'
);
CREATE TYPE "AmazonDeletionRequestStatus" AS ENUM (
  'PENDING', 'SAFE_STATE', 'PROCESSING', 'COMPLETED',
  'PARTIAL_FAILURE', 'FAILED'
);
CREATE TYPE "AmazonRetentionRunStatus" AS ENUM (
  'RUNNING', 'COMPLETED', 'PARTIAL_FAILURE', 'FAILED'
);

CREATE TABLE "amazon_deletion_requests" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "requested_by_user_id" TEXT,
  "provider_key" TEXT NOT NULL DEFAULT 'amazon-sp-api',
  "marketplace_id" TEXT,
  "reason" "AmazonDeletionRequestReason" NOT NULL,
  "status" "AmazonDeletionRequestStatus" NOT NULL DEFAULT 'PENDING',
  "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deadline_at" TIMESTAMP(3) NOT NULL,
  "cutoff_at" TIMESTAMP(3) NOT NULL,
  "safe_state_at" TIMESTAMP(3),
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "failure_code" TEXT,
  "deleted_counts" JSONB,
  "idempotency_key" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "amazon_deletion_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "amazon_deletion_requests_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "amazon_deletion_requests_requested_by_user_id_fkey"
    FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "amazon_deletion_requests_deadline_check"
    CHECK ("deadline_at" >= "requested_at" AND "cutoff_at" <= "requested_at")
);
CREATE UNIQUE INDEX "amazon_deletion_requests_org_idempotency_key"
  ON "amazon_deletion_requests"("organization_id", "idempotency_key");
CREATE INDEX "amazon_deletion_requests_status_deadline_idx"
  ON "amazon_deletion_requests"("status", "deadline_at");
CREATE INDEX "amazon_deletion_requests_org_requested_idx"
  ON "amazon_deletion_requests"("organization_id", "requested_at" DESC);

CREATE TABLE "amazon_deletion_tombstones" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "deletion_request_id" TEXT NOT NULL,
  "provider_key" TEXT NOT NULL,
  "marketplace_id" TEXT,
  "cutoff_at" TIMESTAMP(3) NOT NULL,
  "scope_hash" TEXT NOT NULL,
  "deleted_at" TIMESTAMP(3) NOT NULL,
  "last_reapplied_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "amazon_deletion_tombstones_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "amazon_deletion_tombstones_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "amazon_deletion_tombstones_deletion_request_id_fkey"
    FOREIGN KEY ("deletion_request_id") REFERENCES "amazon_deletion_requests"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "amazon_deletion_tombstones_deletion_request_id_key"
  ON "amazon_deletion_tombstones"("deletion_request_id");
CREATE UNIQUE INDEX "amazon_deletion_tombstones_org_scope_key"
  ON "amazon_deletion_tombstones"("organization_id", "scope_hash");
CREATE INDEX "amazon_deletion_tombstones_org_cutoff_idx"
  ON "amazon_deletion_tombstones"("organization_id", "cutoff_at");

CREATE TABLE "amazon_retention_runs" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "status" "AmazonRetentionRunStatus" NOT NULL DEFAULT 'RUNNING',
  "mode" TEXT NOT NULL,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "cutoff_at" TIMESTAMP(3) NOT NULL,
  "deleted_counts" JSONB,
  "failure_code" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "amazon_retention_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "amazon_retention_runs_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "amazon_retention_runs_org_started_idx"
  ON "amazon_retention_runs"("organization_id", "started_at" DESC);
CREATE INDEX "amazon_retention_runs_status_started_idx"
  ON "amazon_retention_runs"("status", "started_at");

-- Existing cache policies may be shorter; they may never be lengthened by
-- this migration. Calendar-month semantics are enforced in both SQL and code.
UPDATE "provider_cache_entries"
SET "retain_until" = LEAST("retain_until", "observed_at" + INTERVAL '18 months'),
    "updated_at" = CURRENT_TIMESTAMP
WHERE lower("provider_key") IN ('amazon-sp-api', 'amazon_sp_api')
  AND "retain_until" > "observed_at" + INTERVAL '18 months';

ALTER TABLE "provider_cache_entries"
  ADD CONSTRAINT "provider_cache_entries_amazon_retention_ceiling_check"
  CHECK (
    lower("provider_key") NOT IN ('amazon-sp-api', 'amazon_sp_api')
    OR "retain_until" <= "observed_at" + INTERVAL '18 months'
  );

-- Historical observations keep their explicit day-based source policy, while
-- the lifecycle query applies the earlier of that date and +18 calendar months.
