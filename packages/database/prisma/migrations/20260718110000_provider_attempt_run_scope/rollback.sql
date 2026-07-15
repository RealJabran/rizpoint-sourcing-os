-- Reverting weakens per-run provider audit isolation. Use only after a verified backup.
DROP INDEX IF EXISTS "provider_call_attempts_organization_id_enrichment_run_id_provider_operation_request_key_attempt_key";
CREATE UNIQUE INDEX "provider_call_attempts_organization_id_provider_operation_request_key_attempt_key"
  ON "provider_call_attempts"("organization_id", "provider", "operation", "request_key", "attempt");
