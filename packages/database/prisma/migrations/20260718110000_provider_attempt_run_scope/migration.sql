-- Provider calls are immutable evidence for one enrichment run. A prior key
-- could upsert a subsequent run's call and re-parent historical audit data.
DROP INDEX IF EXISTS "provider_call_attempts_organization_id_provider_operation_request_key_attempt_key";
CREATE UNIQUE INDEX "provider_call_attempts_organization_id_enrichment_run_id_provider_operation_request_key_attempt_key"
  ON "provider_call_attempts"("organization_id", "enrichment_run_id", "provider", "operation", "request_key", "attempt");
