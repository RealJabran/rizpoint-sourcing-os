-- Prompt 36I: additive security operations, incident, alert, review and
-- minimum-retention evidence. No provider payload or secret belongs here.

ALTER TYPE "SecurityAuditEventType" ADD VALUE IF NOT EXISTS 'ACCESS_DENIED';
ALTER TYPE "SecurityAuditEventType" ADD VALUE IF NOT EXISTS 'HIGH_RISK_EXPORT';
ALTER TYPE "SecurityAuditEventType" ADD VALUE IF NOT EXISTS 'CONFIGURATION_CHANGED';
ALTER TYPE "SecurityAuditEventType" ADD VALUE IF NOT EXISTS 'PROVIDER_ANOMALY';
ALTER TYPE "SecurityAuditEventType" ADD VALUE IF NOT EXISTS 'SECURITY_ERROR';
ALTER TYPE "SecurityAuditEventType" ADD VALUE IF NOT EXISTS 'ADMINISTRATIVE_ACTION';
ALTER TYPE "SecurityAuditEventType" ADD VALUE IF NOT EXISTS 'MALWARE_DETECTED';
ALTER TYPE "SecurityAuditEventType" ADD VALUE IF NOT EXISTS 'BACKUP_FAILED';
ALTER TYPE "SecurityAuditEventType" ADD VALUE IF NOT EXISTS 'RESTORE_TEST_FAILED';
ALTER TYPE "SecurityAuditEventType" ADD VALUE IF NOT EXISTS 'LOG_PIPELINE_FAILED';
ALTER TYPE "SecurityAuditEventType" ADD VALUE IF NOT EXISTS 'DATASTORE_READINESS_FAILED';
ALTER TYPE "SecurityAuditEventType" ADD VALUE IF NOT EXISTS 'SECRET_SCAN_FAILED';

CREATE TYPE "SecurityEventOutcome" AS ENUM ('SUCCESS', 'FAILURE', 'DENIED', 'WARNING');
CREATE TYPE "SecurityControlType" AS ENUM (
  'SECURITY_LOG_REVIEW', 'INCIDENT_RESPONSE_PLAN_REVIEW',
  'VULNERABILITY_SCAN', 'MALWARE_UPDATE_REVIEW', 'ACCESS_REVIEW',
  'BACKUP_RESTORE_TEST', 'RISK_ASSESSMENT', 'PENETRATION_TEST',
  'API_CREDENTIAL_ROTATION', 'ENCRYPTION_KEY_ROTATION',
  'SECURITY_AWARENESS_TRAINING', 'THIRD_PARTY_RISK_REVIEW'
);
CREATE TYPE "SecurityControlResult" AS ENUM ('PASS', 'FAIL', 'FINDINGS');
CREATE TYPE "SecurityAlertType" AS ENUM (
  'REPEATED_AUTH_FAILURES', 'ACCOUNT_LOCKOUT', 'MFA_FAILURES',
  'UNEXPECTED_ADMIN_ACTION', 'CREDENTIAL_CHANGE',
  'AMAZON_AUTHORIZATION_SPIKE', 'AMAZON_THROTTLE_ANOMALY',
  'PROVIDER_RATE_ANOMALY', 'MALWARE_DETECTION', 'BACKUP_FAILURE',
  'RESTORE_TEST_FAILURE', 'LOG_PIPELINE_FAILURE',
  'DATASTORE_READINESS_FAILURE', 'SECRET_SCAN_FAILURE'
);
CREATE TYPE "SecurityAlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');
CREATE TYPE "SecurityIncidentSeverity" AS ENUM ('SEV_1', 'SEV_2', 'SEV_3', 'SEV_4');
CREATE TYPE "SecurityIncidentStatus" AS ENUM ('OPEN', 'CONTAINED', 'RECOVERING', 'CLOSED');

ALTER TABLE "security_audit_events"
  ADD COLUMN "outcome" "SecurityEventOutcome" NOT NULL DEFAULT 'SUCCESS',
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'APPLICATION',
  ADD COLUMN "request_correlation_id" TEXT,
  ADD COLUMN "source_principal_hash" TEXT,
  ADD COLUMN "retention_until" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '12 months');
CREATE INDEX "security_audit_events_org_retention_idx"
  ON "security_audit_events"("organization_id", "retention_until");

CREATE TABLE "security_control_records" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "reviewer_user_id" TEXT,
  "control_type" "SecurityControlType" NOT NULL,
  "result" "SecurityControlResult" NOT NULL,
  "period_started_at" TIMESTAMP(3),
  "period_ended_at" TIMESTAMP(3),
  "performed_at" TIMESTAMP(3) NOT NULL,
  "next_due_at" TIMESTAMP(3) NOT NULL,
  "evidence_reference" TEXT,
  "summary" TEXT NOT NULL,
  "findings" JSONB,
  "action_items" JSONB,
  "idempotency_key" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "security_control_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "security_control_records_organization_id_fkey" FOREIGN KEY ("organization_id")
    REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "security_control_records_reviewer_user_id_fkey" FOREIGN KEY ("reviewer_user_id")
    REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "security_control_records_period_check" CHECK (
    "period_started_at" IS NULL OR "period_ended_at" IS NULL OR "period_started_at" <= "period_ended_at"
  ),
  CONSTRAINT "security_control_records_due_check" CHECK ("performed_at" < "next_due_at")
);
CREATE UNIQUE INDEX "security_control_records_org_idempotency_key"
  ON "security_control_records"("organization_id", "idempotency_key");
CREATE INDEX "security_control_records_org_type_performed_idx"
  ON "security_control_records"("organization_id", "control_type", "performed_at" DESC);
CREATE INDEX "security_control_records_org_next_due_idx"
  ON "security_control_records"("organization_id", "next_due_at");

CREATE TABLE "security_alerts" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "alert_type" "SecurityAlertType" NOT NULL,
  "status" "SecurityAlertStatus" NOT NULL DEFAULT 'OPEN',
  "severity" TEXT NOT NULL,
  "dedupe_key" TEXT NOT NULL,
  "observed_at" TIMESTAMP(3) NOT NULL,
  "request_correlation_id" TEXT,
  "trigger_inputs" JSONB NOT NULL,
  "acknowledged_at" TIMESTAMP(3),
  "acknowledged_by_user_id" TEXT,
  "resolved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "security_alerts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "security_alerts_organization_id_fkey" FOREIGN KEY ("organization_id")
    REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "security_alerts_acknowledged_by_user_id_fkey" FOREIGN KEY ("acknowledged_by_user_id")
    REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "security_alerts_org_dedupe_key"
  ON "security_alerts"("organization_id", "dedupe_key");
CREATE INDEX "security_alerts_org_status_observed_idx"
  ON "security_alerts"("organization_id", "status", "observed_at" DESC);
CREATE INDEX "security_alerts_org_type_observed_idx"
  ON "security_alerts"("organization_id", "alert_type", "observed_at" DESC);

CREATE TABLE "security_incidents" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "severity" "SecurityIncidentSeverity" NOT NULL,
  "status" "SecurityIncidentStatus" NOT NULL DEFAULT 'OPEN',
  "detected_at" TIMESTAMP(3) NOT NULL,
  "amazon_notification_required" BOOLEAN NOT NULL,
  "amazon_notification_due_at" TIMESTAMP(3),
  "amazon_notified_at" TIMESTAMP(3),
  "amazon_incident_reference" TEXT,
  "incident_commander_user_id" TEXT,
  "non_sensitive_summary" TEXT NOT NULL,
  "closed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "security_incidents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "security_incidents_organization_id_fkey" FOREIGN KEY ("organization_id")
    REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "security_incidents_commander_user_id_fkey" FOREIGN KEY ("incident_commander_user_id")
    REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "security_incidents_notification_check" CHECK (
    ("amazon_notification_required" = false AND "amazon_notification_due_at" IS NULL)
    OR ("amazon_notification_required" = true AND "amazon_notification_due_at" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "security_incidents_org_reference_key"
  ON "security_incidents"("organization_id", "reference");
CREATE INDEX "security_incidents_org_status_detected_idx"
  ON "security_incidents"("organization_id", "status", "detected_at" DESC);
CREATE INDEX "security_incidents_org_notification_due_idx"
  ON "security_incidents"("organization_id", "amazon_notification_due_at");
