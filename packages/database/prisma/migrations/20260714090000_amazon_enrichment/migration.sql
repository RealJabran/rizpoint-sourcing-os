ALTER TYPE "ScanJobStatus" ADD VALUE IF NOT EXISTS 'ENRICHING';
ALTER TYPE "ScanJobStatus" ADD VALUE IF NOT EXISTS 'PARTIAL_SUCCESS';

CREATE TYPE "ProviderKind" AS ENUM ('AMAZON_SP_API', 'MOCK_AMAZON', 'MOCK_HISTORY');
CREATE TYPE "ProviderConnectionMode" AS ENUM ('MOCK', 'SELF_AUTHORIZED', 'OAUTH');
CREATE TYPE "ProviderConnectionStatus" AS ENUM ('PENDING', 'ACTIVE', 'AUTH_REQUIRED', 'REVOKED', 'ERROR');
CREATE TYPE "EnrichmentRunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'PARTIAL_SUCCESS', 'FAILED_RETRYABLE', 'FAILED_FINAL');
CREATE TYPE "EnrichmentItemStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'PARTIAL_SUCCESS', 'FAILED_RETRYABLE', 'FAILED_FINAL');
CREATE TYPE "EnrichmentMetricType" AS ENUM ('CATALOG', 'PRICING', 'FEES', 'RESTRICTIONS', 'HISTORY');
CREATE TYPE "ProviderAttemptStatus" AS ENUM ('SUCCESS', 'RETRYABLE_ERROR', 'PERMANENT_ERROR', 'THROTTLED');

CREATE TABLE "provider_connections" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "provider" "ProviderKind" NOT NULL,
  "mode" "ProviderConnectionMode" NOT NULL,
  "status" "ProviderConnectionStatus" NOT NULL DEFAULT 'PENDING',
  "seller_id" TEXT,
  "marketplace_id" TEXT NOT NULL,
  "region" TEXT NOT NULL,
  "encrypted_refresh_token" TEXT,
  "encryption_nonce" TEXT,
  "encryption_tag" TEXT,
  "encryption_key_version" INTEGER,
  "authorized_at" TIMESTAMP(3),
  "last_validated_at" TIMESTAMP(3),
  "last_success_at" TIMESTAMP(3),
  "last_error_code" TEXT,
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "provider_connections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "provider_authorization_states" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "provider_connection_id" TEXT,
  "provider" "ProviderKind" NOT NULL,
  "state_hash" TEXT NOT NULL,
  "marketplace_id" TEXT NOT NULL,
  "region" TEXT NOT NULL,
  "return_path" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "consumed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "provider_authorization_states_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "enrichment_runs" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "scan_job_id" TEXT NOT NULL,
  "provider_connection_id" TEXT,
  "status" "EnrichmentRunStatus" NOT NULL DEFAULT 'PENDING',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "missing_metric_count" INTEGER NOT NULL DEFAULT 0,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "enrichment_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "enrichment_items" (
  "id" TEXT NOT NULL,
  "enrichment_run_id" TEXT NOT NULL,
  "supplier_row_id" TEXT NOT NULL,
  "asin" TEXT NOT NULL,
  "status" "EnrichmentItemStatus" NOT NULL DEFAULT 'PENDING',
  "missing_metrics" JSONB NOT NULL DEFAULT '[]',
  "last_error_code" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "enrichment_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "provider_observations" (
  "id" TEXT NOT NULL,
  "enrichment_item_id" TEXT NOT NULL,
  "metric_type" "EnrichmentMetricType" NOT NULL,
  "provider" "ProviderKind" NOT NULL,
  "provider_reference" TEXT,
  "marketplace_id" TEXT NOT NULL,
  "observed_at" TIMESTAMP(3) NOT NULL,
  "fresh_until" TIMESTAMP(3) NOT NULL,
  "freshness_state" "ExternalFreshnessState" NOT NULL,
  "currency" TEXT,
  "primary_amount" DECIMAL(18,4),
  "secondary_amount" DECIMAL(18,4),
  "rank" INTEGER,
  "payload" JSONB NOT NULL,
  "response_checksum" TEXT,
  "error_code" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "provider_observations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "provider_call_attempts" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "enrichment_run_id" TEXT,
  "provider" "ProviderKind" NOT NULL,
  "operation" TEXT NOT NULL,
  "request_key" TEXT NOT NULL,
  "status" "ProviderAttemptStatus" NOT NULL,
  "attempt" INTEGER NOT NULL,
  "http_status" INTEGER,
  "error_code" TEXT,
  "provider_request_id" TEXT,
  "retry_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "provider_call_attempts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "provider_connections_organization_id_provider_marketplace_id_key" ON "provider_connections"("organization_id", "provider", "marketplace_id");
CREATE INDEX "provider_connections_organization_id_status_idx" ON "provider_connections"("organization_id", "status");
CREATE UNIQUE INDEX "provider_authorization_states_state_hash_key" ON "provider_authorization_states"("state_hash");
CREATE INDEX "provider_authorization_states_organization_id_expires_at_idx" ON "provider_authorization_states"("organization_id", "expires_at");
CREATE UNIQUE INDEX "enrichment_runs_scan_job_id_provider_connection_id_key" ON "enrichment_runs"("scan_job_id", "provider_connection_id");
CREATE INDEX "enrichment_runs_organization_id_status_idx" ON "enrichment_runs"("organization_id", "status");
CREATE UNIQUE INDEX "enrichment_items_enrichment_run_id_supplier_row_id_key" ON "enrichment_items"("enrichment_run_id", "supplier_row_id");
CREATE INDEX "enrichment_items_enrichment_run_id_status_idx" ON "enrichment_items"("enrichment_run_id", "status");
CREATE UNIQUE INDEX "provider_observations_enrichment_item_id_metric_type_provider_key" ON "provider_observations"("enrichment_item_id", "metric_type", "provider");
CREATE INDEX "provider_observations_metric_type_fresh_until_idx" ON "provider_observations"("metric_type", "fresh_until");
CREATE UNIQUE INDEX "provider_call_attempts_provider_operation_request_key_attempt_key" ON "provider_call_attempts"("provider", "operation", "request_key", "attempt");
CREATE INDEX "provider_call_attempts_organization_id_provider_created_at_idx" ON "provider_call_attempts"("organization_id", "provider", "created_at");

ALTER TABLE "provider_connections" ADD CONSTRAINT "provider_connections_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "provider_authorization_states" ADD CONSTRAINT "provider_authorization_states_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "provider_authorization_states" ADD CONSTRAINT "provider_authorization_states_provider_connection_id_fkey" FOREIGN KEY ("provider_connection_id") REFERENCES "provider_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "enrichment_runs" ADD CONSTRAINT "enrichment_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "enrichment_runs" ADD CONSTRAINT "enrichment_runs_scan_job_id_fkey" FOREIGN KEY ("scan_job_id") REFERENCES "scan_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "enrichment_runs" ADD CONSTRAINT "enrichment_runs_provider_connection_id_fkey" FOREIGN KEY ("provider_connection_id") REFERENCES "provider_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "enrichment_items" ADD CONSTRAINT "enrichment_items_enrichment_run_id_fkey" FOREIGN KEY ("enrichment_run_id") REFERENCES "enrichment_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "enrichment_items" ADD CONSTRAINT "enrichment_items_supplier_row_id_fkey" FOREIGN KEY ("supplier_row_id") REFERENCES "supplier_rows"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "provider_observations" ADD CONSTRAINT "provider_observations_enrichment_item_id_fkey" FOREIGN KEY ("enrichment_item_id") REFERENCES "enrichment_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "provider_call_attempts" ADD CONSTRAINT "provider_call_attempts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "provider_call_attempts" ADD CONSTRAINT "provider_call_attempts_enrichment_run_id_fkey" FOREIGN KEY ("enrichment_run_id") REFERENCES "enrichment_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
