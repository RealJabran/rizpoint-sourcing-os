-- Destructive rollback. Back up security evidence before use.
DROP TABLE IF EXISTS "credential_rotation_records";
DROP TABLE IF EXISTS "security_audit_events";
DROP TABLE IF EXISTS "organization_access_reviews";
DROP TABLE IF EXISTS "user_sessions";
DROP TABLE IF EXISTS "authentication_challenges";
DROP TABLE IF EXISTS "user_mfa_recovery_codes";
DROP TABLE IF EXISTS "user_mfa_factors";
DROP TABLE IF EXISTS "user_password_history";

DROP INDEX IF EXISTS "organization_memberships_id_organization_id_key";
ALTER TABLE "organization_memberships"
  DROP COLUMN IF EXISTS "deactivated_at",
  DROP COLUMN IF EXISTS "active";

ALTER TABLE "users"
  DROP COLUMN IF EXISTS "last_authenticated_at",
  DROP COLUMN IF EXISTS "locked_until",
  DROP COLUMN IF EXISTS "last_failed_login_at",
  DROP COLUMN IF EXISTS "failed_login_attempts",
  DROP COLUMN IF EXISTS "deactivated_at",
  DROP COLUMN IF EXISTS "must_change_password",
  DROP COLUMN IF EXISTS "password_expires_at",
  DROP COLUMN IF EXISTS "password_changed_at",
  DROP COLUMN IF EXISTS "last_name",
  DROP COLUMN IF EXISTS "first_name";

-- PostgreSQL enum values cannot be removed safely in place. OWNER remains the
-- only value used by the pre-36G application after an application-first rollback.
DROP TYPE IF EXISTS "CredentialRotationType";
DROP TYPE IF EXISTS "AccessReviewDecision";
DROP TYPE IF EXISTS "SecurityAuditEventType";
DROP TYPE IF EXISTS "AuthenticationChallengePurpose";
