-- Destructive rollback for Prompt 03 provider-runtime state only.
-- Back up runtime telemetry/cache/budget state before use outside disposable environments.
DROP TABLE IF EXISTS "provider_request_attempts";
DROP TABLE IF EXISTS "provider_request_leases";
DROP TABLE IF EXISTS "provider_cache_entries";
DROP TABLE IF EXISTS "provider_budget_reservations";
DROP TABLE IF EXISTS "provider_rate_budgets";
DROP TABLE IF EXISTS "provider_entitlements";
DROP TABLE IF EXISTS "provider_credentials";

ALTER TABLE "provider_connections"
  DROP CONSTRAINT IF EXISTS "provider_connections_id_organization_id_key";

DROP TYPE IF EXISTS "ProviderRequestLeaseState";
DROP TYPE IF EXISTS "ProviderBudgetReservationStatus";
DROP TYPE IF EXISTS "ProviderBudgetUnit";
DROP TYPE IF EXISTS "ProviderOperationalState";
DROP TYPE IF EXISTS "ProviderRuntimeMode";
DROP TYPE IF EXISTS "ProviderCapability";
