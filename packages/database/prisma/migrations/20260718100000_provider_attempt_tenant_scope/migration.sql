-- Provider attempts are tenant-owned audit records. The prior global key could
-- overwrite one organization's attempt when another organization enriched the
-- same ASIN at the same retry number.
DROP INDEX IF EXISTS "provider_call_attempts_provider_operation_request_key_attempt_key";
CREATE UNIQUE INDEX "provider_call_attempts_organization_id_provider_operation_request_key_attempt_key"
  ON "provider_call_attempts"("organization_id", "provider", "operation", "request_key", "attempt");
