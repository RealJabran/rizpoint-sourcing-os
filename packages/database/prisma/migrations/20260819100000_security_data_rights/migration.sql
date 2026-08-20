-- Prompt 34: provider data-rights enforcement and durable API abuse controls.
CREATE TYPE "ProviderDataUsageScope" AS ENUM ('INTERNAL_ONLY', 'REDISTRIBUTABLE');
CREATE TYPE "ProviderExportPolicy" AS ENUM ('BLOCK', 'ALLOW', 'FIELD_ALLOWLIST');

ALTER TABLE "provider_entitlements"
  ADD COLUMN "data_usage_scope" "ProviderDataUsageScope" NOT NULL DEFAULT 'INTERNAL_ONLY',
  ADD COLUMN "export_policy" "ProviderExportPolicy" NOT NULL DEFAULT 'BLOCK',
  ADD COLUMN "exportable_fields" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "data_retention_days" INTEGER,
  ADD COLUMN "terms_reference" TEXT,
  ADD COLUMN "terms_version" TEXT,
  ADD COLUMN "terms_reviewed_at" TIMESTAMP(3),
  ADD COLUMN "rights_effective_at" TIMESTAMP(3),
  ADD COLUMN "rights_expires_at" TIMESTAMP(3),
  ADD CONSTRAINT "provider_entitlements_retention_days_check"
    CHECK ("data_retention_days" IS NULL OR "data_retention_days" BETWEEN 1 AND 3650),
  ADD CONSTRAINT "provider_entitlements_export_rights_check"
    CHECK (
      "export_policy" = 'BLOCK'
      OR (
        "data_usage_scope" = 'REDISTRIBUTABLE'
        AND "data_retention_days" IS NOT NULL
        AND "terms_reference" IS NOT NULL
        AND length(trim("terms_reference")) > 0
        AND "terms_version" IS NOT NULL
        AND length(trim("terms_version")) > 0
        AND "terms_reviewed_at" IS NOT NULL
        AND "rights_effective_at" IS NOT NULL
      )
    ),
  ADD CONSTRAINT "provider_entitlements_field_allowlist_check"
    CHECK ("export_policy" <> 'FIELD_ALLOWLIST' OR cardinality("exportable_fields") > 0),
  ADD CONSTRAINT "provider_entitlements_rights_window_check"
    CHECK (
      "rights_expires_at" IS NULL
      OR ("rights_effective_at" IS NOT NULL AND "rights_expires_at" > "rights_effective_at")
    );

CREATE TABLE "api_rate_limit_buckets" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "principal_hash" TEXT NOT NULL,
  "window_start" TIMESTAMP(3) NOT NULL,
  "request_count" INTEGER NOT NULL DEFAULT 0,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "api_rate_limit_buckets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "api_rate_limit_buckets_count_check" CHECK ("request_count" >= 0),
  CONSTRAINT "api_rate_limit_buckets_window_check" CHECK ("expires_at" > "window_start"),
  CONSTRAINT "api_rate_limit_buckets_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "api_rate_limit_buckets_identity_key"
  ON "api_rate_limit_buckets"("organization_id", "scope", "principal_hash", "window_start");
CREATE INDEX "api_rate_limit_buckets_expires_idx"
  ON "api_rate_limit_buckets"("expires_at");
