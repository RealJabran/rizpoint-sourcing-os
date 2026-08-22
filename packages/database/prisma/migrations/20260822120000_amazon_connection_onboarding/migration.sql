CREATE TYPE "ProviderConnectionJobKind" AS ENUM ('OAUTH_COMPLETE', 'VALIDATE', 'REFRESH_CAPABILITIES');
CREATE TYPE "ProviderConnectionJobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED_RETRYABLE', 'FAILED_FINAL');

ALTER TABLE "provider_authorization_states"
  ADD COLUMN "encrypted_oauth_code" TEXT,
  ADD COLUMN "oauth_code_key_version" INTEGER,
  ADD COLUMN "seller_id" TEXT,
  ADD COLUMN "callback_received_at" TIMESTAMP(3),
  ADD COLUMN "completed_at" TIMESTAMP(3),
  ADD COLUMN "failure_code" TEXT;

ALTER TABLE "provider_authorization_states"
  DROP CONSTRAINT "provider_authorization_states_provider_connection_id_fkey";
ALTER TABLE "provider_authorization_states"
  ADD CONSTRAINT "provider_authorization_states_connection_org_fkey"
  FOREIGN KEY ("provider_connection_id", "organization_id") REFERENCES "provider_connections"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "provider_authorization_states_id_organization_id_key"
  ON "provider_authorization_states"("id", "organization_id");

CREATE TABLE "provider_connection_marketplaces" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "provider_connection_id" TEXT NOT NULL,
  "marketplace_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "country_code" TEXT,
  "domain_name" TEXT,
  "default_currency_code" TEXT,
  "default_language_code" TEXT,
  "is_participating" BOOLEAN NOT NULL,
  "has_suspended_listings" BOOLEAN NOT NULL,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "observed_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "provider_connection_marketplaces_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "provider_connection_marketplaces_provider_connection_id_marketplace_id_key"
  ON "provider_connection_marketplaces"("provider_connection_id", "marketplace_id");
CREATE INDEX "provider_connection_marketplaces_org_market_idx"
  ON "provider_connection_marketplaces"("organization_id", "marketplace_id", "is_participating");
CREATE INDEX "provider_connection_marketplaces_default_idx"
  ON "provider_connection_marketplaces"("provider_connection_id", "is_default");
CREATE UNIQUE INDEX "provider_connection_marketplaces_one_default_idx"
  ON "provider_connection_marketplaces"("provider_connection_id") WHERE "is_default" = true;

ALTER TABLE "provider_connection_marketplaces"
  ADD CONSTRAINT "provider_connection_marketplaces_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "provider_connection_marketplaces"
  ADD CONSTRAINT "provider_connection_marketplaces_connection_org_fkey"
  FOREIGN KEY ("provider_connection_id", "organization_id") REFERENCES "provider_connections"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "provider_connection_jobs" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "provider_connection_id" TEXT,
  "authorization_state_id" TEXT,
  "kind" "ProviderConnectionJobKind" NOT NULL,
  "status" "ProviderConnectionJobStatus" NOT NULL DEFAULT 'PENDING',
  "idempotency_key" TEXT NOT NULL,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "result_code" TEXT,
  "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "provider_connection_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "provider_connection_jobs_target_check" CHECK (
    ("kind" = 'OAUTH_COMPLETE' AND "authorization_state_id" IS NOT NULL) OR
    ("kind" <> 'OAUTH_COMPLETE' AND "provider_connection_id" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "provider_connection_jobs_id_organization_id_key"
  ON "provider_connection_jobs"("id", "organization_id");
CREATE UNIQUE INDEX "provider_connection_jobs_organization_id_idempotency_key_key"
  ON "provider_connection_jobs"("organization_id", "idempotency_key");
CREATE INDEX "provider_connection_jobs_organization_id_status_requested_at_idx"
  ON "provider_connection_jobs"("organization_id", "status", "requested_at");
CREATE INDEX "provider_connection_jobs_provider_connection_id_organization_id_idx"
  ON "provider_connection_jobs"("provider_connection_id", "organization_id");

ALTER TABLE "provider_connection_jobs"
  ADD CONSTRAINT "provider_connection_jobs_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "provider_connection_jobs"
  ADD CONSTRAINT "provider_connection_jobs_connection_org_fkey"
  FOREIGN KEY ("provider_connection_id", "organization_id") REFERENCES "provider_connections"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "provider_connection_jobs"
  ADD CONSTRAINT "provider_connection_jobs_auth_state_org_fkey"
  FOREIGN KEY ("authorization_state_id", "organization_id") REFERENCES "provider_authorization_states"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "outbox_events" ADD COLUMN "provider_connection_job_id" TEXT;
CREATE UNIQUE INDEX "outbox_events_provider_connection_job_id_event_type_key"
  ON "outbox_events"("provider_connection_job_id", "event_type");
ALTER TABLE "outbox_events"
  ADD CONSTRAINT "outbox_events_provider_connection_job_id_fkey"
  FOREIGN KEY ("provider_connection_job_id") REFERENCES "provider_connection_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
