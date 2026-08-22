CREATE TYPE "ProductResearchRunKind" AS ENUM ('PRODUCT_LOOKUP', 'CATALOG_SEARCH');

CREATE TYPE "ProductResearchRunStatus" AS ENUM (
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'PARTIAL_SUCCESS',
  'FAILED_RETRYABLE',
  'FAILED_FINAL'
);

CREATE TABLE "product_research_runs" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "kind" "ProductResearchRunKind" NOT NULL,
  "status" "ProductResearchRunStatus" NOT NULL DEFAULT 'PENDING',
  "marketplace_id" TEXT NOT NULL,
  "provider_key" TEXT NOT NULL,
  "provider_mode" "ProviderRuntimeMode" NOT NULL,
  "query_type" TEXT NOT NULL,
  "query_text" TEXT NOT NULL,
  "normalized_query" TEXT NOT NULL,
  "requested_limit" INTEGER NOT NULL DEFAULT 20,
  "sale_price" DECIMAL(18,4),
  "currency" TEXT,
  "force_refresh" BOOLEAN NOT NULL DEFAULT false,
  "idempotency_key" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "result_count" INTEGER NOT NULL DEFAULT 0,
  "error_code" TEXT,
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "product_research_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "product_research_run_items" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "run_id" TEXT NOT NULL,
  "catalog_product_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "status" "ProductResearchRunStatus" NOT NULL DEFAULT 'COMPLETED',
  "evidence" JSONB NOT NULL,
  "source" TEXT NOT NULL,
  "data_origin" TEXT NOT NULL,
  "observed_at" TIMESTAMP(3) NOT NULL,
  "fresh_until" TIMESTAMP(3),
  "freshness_state" "ExternalFreshnessState" NOT NULL,
  "completeness" "ResearchObservationCompleteness" NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "product_research_run_items_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "outbox_events"
ADD COLUMN "product_research_run_id" TEXT;

CREATE UNIQUE INDEX "product_research_runs_org_idempotency_key"
ON "product_research_runs"("organization_id", "idempotency_key");
CREATE UNIQUE INDEX "product_research_runs_id_org_key"
ON "product_research_runs"("id", "organization_id");
CREATE INDEX "product_research_runs_org_market_created_idx"
ON "product_research_runs"("organization_id", "marketplace_id", "created_at");
CREATE INDEX "product_research_runs_status_updated_idx"
ON "product_research_runs"("status", "updated_at");

CREATE UNIQUE INDEX "product_research_items_run_product_key"
ON "product_research_run_items"("run_id", "catalog_product_id");
CREATE INDEX "product_research_items_org_product_created_idx"
ON "product_research_run_items"("organization_id", "catalog_product_id", "created_at");

CREATE UNIQUE INDEX "outbox_events_product_research_run_id_event_type_key"
ON "outbox_events"("product_research_run_id", "event_type");

ALTER TABLE "product_research_runs"
ADD CONSTRAINT "product_research_runs_organization_id_fkey"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "product_research_run_items"
ADD CONSTRAINT "product_research_items_organization_id_fkey"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "product_research_run_items"
ADD CONSTRAINT "product_research_items_run_org_fkey"
FOREIGN KEY ("run_id", "organization_id")
REFERENCES "product_research_runs"("id", "organization_id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_research_run_items"
ADD CONSTRAINT "product_research_items_catalog_product_id_fkey"
FOREIGN KEY ("catalog_product_id") REFERENCES "catalog_products"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "outbox_events"
ADD CONSTRAINT "outbox_events_product_research_run_id_fkey"
FOREIGN KEY ("product_research_run_id") REFERENCES "product_research_runs"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
