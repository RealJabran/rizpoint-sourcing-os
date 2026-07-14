-- Reverting removes tenant-scoped protection. Only use after a verified backup.
DROP INDEX IF EXISTS "provider_call_attempts_organization_id_provider_operation_request_key_attempt_key";
CREATE UNIQUE INDEX "provider_call_attempts_provider_operation_request_key_attempt_key"
  ON "provider_call_attempts"("provider", "operation", "request_key", "attempt");
