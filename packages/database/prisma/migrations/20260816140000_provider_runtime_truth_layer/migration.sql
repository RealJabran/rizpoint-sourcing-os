-- Additive provider-runtime control plane. Provider payloads and plaintext
-- credentials are intentionally absent from telemetry and entitlement tables.
CREATE TYPE "ProviderCapability" AS ENUM (
  'CATALOG', 'COMPETITIVE_OFFERS', 'FEES', 'RESTRICTIONS', 'MARKET_HISTORY',
  'KEYWORD_DISCOVERY', 'REVERSE_ASIN', 'SEARCH_RANK',
  'CATEGORY_INTELLIGENCE', 'BRAND_INTELLIGENCE', 'SELLER_INTELLIGENCE',
  'AD_INTELLIGENCE', 'REVIEW_INTELLIGENCE'
);
CREATE TYPE "ProviderRuntimeMode" AS ENUM ('MOCK', 'LIVE');
CREATE TYPE "ProviderOperationalState" AS ENUM (
  'NOT_CONFIGURED', 'CONFIGURED', 'AUTHORIZED', 'UNAUTHORIZED',
  'QUOTA_EXHAUSTED', 'THROTTLED', 'UNAVAILABLE', 'PARTIAL', 'HEALTHY'
);
CREATE TYPE "ProviderBudgetUnit" AS ENUM ('REQUEST', 'CREDIT', 'TOKEN');
CREATE TYPE "ProviderBudgetReservationStatus" AS ENUM ('RESERVED', 'CONSUMED', 'RELEASED', 'EXPIRED');
CREATE TYPE "ProviderRequestLeaseState" AS ENUM ('ACTIVE', 'COMPLETED', 'RELEASED');

ALTER TABLE "provider_connections"
  ADD CONSTRAINT "provider_connections_id_organization_id_key"
  UNIQUE ("id", "organization_id");

CREATE TABLE "provider_credentials" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "provider_key" TEXT NOT NULL,
  "credential_name" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "encryption_nonce" TEXT NOT NULL,
  "encryption_tag" TEXT NOT NULL,
  "encryption_key_version" INTEGER NOT NULL,
  "rotated_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "provider_credentials_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "provider_credentials_key_version_check" CHECK ("encryption_key_version" > 0)
);

CREATE TABLE "provider_entitlements" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "provider_connection_id" TEXT,
  "provider_key" TEXT NOT NULL,
  "marketplace_id" TEXT NOT NULL,
  "capability" "ProviderCapability" NOT NULL,
  "mode" "ProviderRuntimeMode" NOT NULL,
  "state" "ProviderOperationalState" NOT NULL,
  "reason_code" TEXT,
  "completeness" "ResearchObservationCompleteness" NOT NULL DEFAULT 'UNKNOWN',
  "checked_at" TIMESTAMP(3) NOT NULL,
  "expires_at" TIMESTAMP(3),
  "retry_at" TIMESTAMP(3),
  "last_success_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "provider_entitlements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "provider_rate_budgets" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "entitlement_id" TEXT NOT NULL,
  "unit" "ProviderBudgetUnit" NOT NULL,
  "window_start" TIMESTAMP(3) NOT NULL,
  "window_end" TIMESTAMP(3) NOT NULL,
  "capacity" DECIMAL(20,4) NOT NULL,
  "reserved" DECIMAL(20,4) NOT NULL DEFAULT 0,
  "consumed" DECIMAL(20,4) NOT NULL DEFAULT 0,
  "estimated_unit_cost" DECIMAL(20,8),
  "cost_currency" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "provider_rate_budgets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "provider_rate_budgets_window_check" CHECK ("window_end" > "window_start"),
  CONSTRAINT "provider_rate_budgets_amounts_check" CHECK (
    "capacity" > 0 AND "reserved" >= 0 AND "consumed" >= 0
    AND "reserved" + "consumed" <= "capacity"
  ),
  CONSTRAINT "provider_rate_budgets_cost_check" CHECK (
    "estimated_unit_cost" IS NULL OR "estimated_unit_cost" >= 0
  ),
  CONSTRAINT "provider_rate_budgets_currency_check" CHECK (
    "cost_currency" IS NULL OR char_length("cost_currency") = 3
  )
);

CREATE TABLE "provider_budget_reservations" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "budget_id" TEXT NOT NULL,
  "request_key" TEXT NOT NULL,
  "units" DECIMAL(20,4) NOT NULL,
  "estimated_cost" DECIMAL(20,8),
  "status" "ProviderBudgetReservationStatus" NOT NULL DEFAULT 'RESERVED',
  "expires_at" TIMESTAMP(3) NOT NULL,
  "consumed_at" TIMESTAMP(3),
  "released_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "provider_budget_reservations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "provider_budget_reservations_units_check" CHECK ("units" > 0),
  CONSTRAINT "provider_budget_reservations_cost_check" CHECK (
    "estimated_cost" IS NULL OR "estimated_cost" >= 0
  )
);

CREATE TABLE "provider_cache_entries" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "entitlement_id" TEXT,
  "provider_key" TEXT NOT NULL,
  "marketplace_id" TEXT NOT NULL,
  "capability" "ProviderCapability" NOT NULL,
  "operation" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "normalized_projection" JSONB,
  "raw_evidence_reference" TEXT,
  "observed_at" TIMESTAMP(3) NOT NULL,
  "fresh_until" TIMESTAMP(3) NOT NULL,
  "stale_until" TIMESTAMP(3) NOT NULL,
  "retain_until" TIMESTAMP(3) NOT NULL,
  "completeness" "ResearchObservationCompleteness" NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "provider_cache_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "provider_cache_entries_windows_check" CHECK (
    "fresh_until" >= "observed_at" AND "stale_until" >= "fresh_until"
    AND "retain_until" >= "stale_until"
  )
);

CREATE TABLE "provider_request_leases" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "provider_key" TEXT NOT NULL,
  "marketplace_id" TEXT NOT NULL,
  "capability" "ProviderCapability" NOT NULL,
  "operation" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "owner_token_hash" TEXT NOT NULL,
  "state" "ProviderRequestLeaseState" NOT NULL DEFAULT 'ACTIVE',
  "lease_expires_at" TIMESTAMP(3) NOT NULL,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "provider_request_leases_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "provider_request_attempts" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "entitlement_id" TEXT,
  "provider_key" TEXT NOT NULL,
  "marketplace_id" TEXT NOT NULL,
  "capability" "ProviderCapability" NOT NULL,
  "operation" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "mode" "ProviderRuntimeMode" NOT NULL,
  "state" "ProviderOperationalState" NOT NULL,
  "attempt" INTEGER NOT NULL,
  "http_status" INTEGER,
  "error_code" TEXT,
  "provider_request_id" TEXT,
  "retry_at" TIMESTAMP(3),
  "cache_outcome" TEXT,
  "budget_unit" "ProviderBudgetUnit",
  "estimated_units" DECIMAL(20,4),
  "estimated_cost" DECIMAL(20,8),
  "cost_currency" TEXT,
  "started_at" TIMESTAMP(3) NOT NULL,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "provider_request_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "provider_request_attempts_attempt_check" CHECK ("attempt" > 0),
  CONSTRAINT "provider_request_attempts_cost_check" CHECK (
    ("estimated_units" IS NULL OR "estimated_units" >= 0)
    AND ("estimated_cost" IS NULL OR "estimated_cost" >= 0)
  ),
  CONSTRAINT "provider_request_attempts_currency_check" CHECK (
    "cost_currency" IS NULL OR char_length("cost_currency") = 3
  )
);

CREATE UNIQUE INDEX "provider_credentials_organization_id_provider_key_credential_name_key"
  ON "provider_credentials"("organization_id", "provider_key", "credential_name");
CREATE INDEX "provider_credentials_organization_id_provider_key_revoked_at_idx"
  ON "provider_credentials"("organization_id", "provider_key", "revoked_at");
CREATE UNIQUE INDEX "provider_entitlements_id_organization_id_key"
  ON "provider_entitlements"("id", "organization_id");
CREATE UNIQUE INDEX "provider_entitlements_org_provider_market_capability_key"
  ON "provider_entitlements"("organization_id", "provider_key", "marketplace_id", "capability");
CREATE INDEX "provider_entitlements_organization_id_state_retry_at_idx"
  ON "provider_entitlements"("organization_id", "state", "retry_at");
CREATE INDEX "provider_entitlements_connection_org_idx"
  ON "provider_entitlements"("provider_connection_id", "organization_id");
CREATE UNIQUE INDEX "provider_rate_budgets_id_organization_id_key"
  ON "provider_rate_budgets"("id", "organization_id");
CREATE UNIQUE INDEX "provider_rate_budgets_entitlement_unit_window_key"
  ON "provider_rate_budgets"("entitlement_id", "unit", "window_start", "window_end");
CREATE INDEX "provider_rate_budgets_organization_id_window_end_idx"
  ON "provider_rate_budgets"("organization_id", "window_end");
CREATE UNIQUE INDEX "provider_budget_reservations_org_budget_request_key"
  ON "provider_budget_reservations"("organization_id", "budget_id", "request_key");
CREATE INDEX "provider_budget_reservations_org_status_expires_idx"
  ON "provider_budget_reservations"("organization_id", "status", "expires_at");
CREATE UNIQUE INDEX "provider_cache_entries_request_key"
  ON "provider_cache_entries"("organization_id", "provider_key", "marketplace_id", "capability", "operation", "request_hash");
CREATE INDEX "provider_cache_entries_org_capability_fresh_idx"
  ON "provider_cache_entries"("organization_id", "capability", "fresh_until");
CREATE INDEX "provider_cache_entries_retain_until_idx" ON "provider_cache_entries"("retain_until");
CREATE UNIQUE INDEX "provider_request_leases_request_key"
  ON "provider_request_leases"("organization_id", "provider_key", "marketplace_id", "capability", "operation", "request_hash");
CREATE INDEX "provider_request_leases_org_state_expires_idx"
  ON "provider_request_leases"("organization_id", "state", "lease_expires_at");
CREATE UNIQUE INDEX "provider_request_attempts_request_attempt_key"
  ON "provider_request_attempts"("organization_id", "provider_key", "marketplace_id", "capability", "operation", "request_hash", "attempt");
CREATE INDEX "provider_request_attempts_org_provider_capability_created_idx"
  ON "provider_request_attempts"("organization_id", "provider_key", "capability", "created_at");
CREATE INDEX "provider_request_attempts_entitlement_org_idx"
  ON "provider_request_attempts"("entitlement_id", "organization_id");

ALTER TABLE "provider_credentials" ADD CONSTRAINT "provider_credentials_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "provider_entitlements" ADD CONSTRAINT "provider_entitlements_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "provider_entitlements" ADD CONSTRAINT "provider_entitlements_connection_org_fkey"
  FOREIGN KEY ("provider_connection_id", "organization_id") REFERENCES "provider_connections"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "provider_rate_budgets" ADD CONSTRAINT "provider_rate_budgets_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "provider_rate_budgets" ADD CONSTRAINT "provider_rate_budgets_entitlement_org_fkey"
  FOREIGN KEY ("entitlement_id", "organization_id") REFERENCES "provider_entitlements"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "provider_budget_reservations" ADD CONSTRAINT "provider_budget_reservations_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "provider_budget_reservations" ADD CONSTRAINT "provider_budget_reservations_budget_org_fkey"
  FOREIGN KEY ("budget_id", "organization_id") REFERENCES "provider_rate_budgets"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "provider_cache_entries" ADD CONSTRAINT "provider_cache_entries_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "provider_cache_entries" ADD CONSTRAINT "provider_cache_entries_entitlement_org_fkey"
  FOREIGN KEY ("entitlement_id", "organization_id") REFERENCES "provider_entitlements"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "provider_request_leases" ADD CONSTRAINT "provider_request_leases_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "provider_request_attempts" ADD CONSTRAINT "provider_request_attempts_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "provider_request_attempts" ADD CONSTRAINT "provider_request_attempts_entitlement_org_fkey"
  FOREIGN KEY ("entitlement_id", "organization_id") REFERENCES "provider_entitlements"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

