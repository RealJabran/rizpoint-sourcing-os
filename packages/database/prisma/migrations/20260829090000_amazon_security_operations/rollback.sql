-- Destructive rollback. Export security control/incident evidence first.
DROP TABLE IF EXISTS "security_incidents";
DROP TABLE IF EXISTS "security_alerts";
DROP TABLE IF EXISTS "security_control_records";

DROP INDEX IF EXISTS "security_audit_events_org_retention_idx";
ALTER TABLE "security_audit_events"
  DROP COLUMN IF EXISTS "retention_until",
  DROP COLUMN IF EXISTS "source_principal_hash",
  DROP COLUMN IF EXISTS "request_correlation_id",
  DROP COLUMN IF EXISTS "source",
  DROP COLUMN IF EXISTS "outcome";

DROP TYPE IF EXISTS "SecurityIncidentStatus";
DROP TYPE IF EXISTS "SecurityIncidentSeverity";
DROP TYPE IF EXISTS "SecurityAlertStatus";
DROP TYPE IF EXISTS "SecurityAlertType";
DROP TYPE IF EXISTS "SecurityControlResult";
DROP TYPE IF EXISTS "SecurityControlType";
DROP TYPE IF EXISTS "SecurityEventOutcome";

-- PostgreSQL enum values added to SecurityAuditEventType cannot be removed
-- safely in place. The older application ignores the added values.
