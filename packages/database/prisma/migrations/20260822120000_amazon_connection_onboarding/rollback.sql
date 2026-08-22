ALTER TABLE "outbox_events" DROP CONSTRAINT IF EXISTS "outbox_events_provider_connection_job_id_fkey";
DROP INDEX IF EXISTS "outbox_events_provider_connection_job_id_event_type_key";
ALTER TABLE "outbox_events" DROP COLUMN IF EXISTS "provider_connection_job_id";

DROP TABLE IF EXISTS "provider_connection_jobs";
DROP TABLE IF EXISTS "provider_connection_marketplaces";

ALTER TABLE "provider_authorization_states"
  DROP CONSTRAINT IF EXISTS "provider_authorization_states_connection_org_fkey";
ALTER TABLE "provider_authorization_states"
  ADD CONSTRAINT "provider_authorization_states_provider_connection_id_fkey"
  FOREIGN KEY ("provider_connection_id") REFERENCES "provider_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP INDEX IF EXISTS "provider_authorization_states_id_organization_id_key";
ALTER TABLE "provider_authorization_states"
  DROP COLUMN IF EXISTS "encrypted_oauth_code",
  DROP COLUMN IF EXISTS "oauth_code_key_version",
  DROP COLUMN IF EXISTS "seller_id",
  DROP COLUMN IF EXISTS "callback_received_at",
  DROP COLUMN IF EXISTS "completed_at",
  DROP COLUMN IF EXISTS "failure_code";

DROP TYPE IF EXISTS "ProviderConnectionJobStatus";
DROP TYPE IF EXISTS "ProviderConnectionJobKind";
