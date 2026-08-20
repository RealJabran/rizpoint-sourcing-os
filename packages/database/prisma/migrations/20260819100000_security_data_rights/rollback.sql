DROP TABLE IF EXISTS "api_rate_limit_buckets";

ALTER TABLE "provider_entitlements"
  DROP CONSTRAINT IF EXISTS "provider_entitlements_rights_window_check",
  DROP CONSTRAINT IF EXISTS "provider_entitlements_field_allowlist_check",
  DROP CONSTRAINT IF EXISTS "provider_entitlements_export_rights_check",
  DROP CONSTRAINT IF EXISTS "provider_entitlements_retention_days_check",
  DROP COLUMN IF EXISTS "rights_expires_at",
  DROP COLUMN IF EXISTS "rights_effective_at",
  DROP COLUMN IF EXISTS "terms_reviewed_at",
  DROP COLUMN IF EXISTS "terms_version",
  DROP COLUMN IF EXISTS "terms_reference",
  DROP COLUMN IF EXISTS "data_retention_days",
  DROP COLUMN IF EXISTS "exportable_fields",
  DROP COLUMN IF EXISTS "export_policy",
  DROP COLUMN IF EXISTS "data_usage_scope";

DROP TYPE IF EXISTS "ProviderExportPolicy";
DROP TYPE IF EXISTS "ProviderDataUsageScope";
