-- Prompt 36G: additive authentication, MFA, RBAC, access-review, and security-audit controls.
-- Existing password hashes are retained. Their current value is inserted into history,
-- and lifecycle timestamps are derived from the existing account creation time.

ALTER TYPE "OrganizationRole" ADD VALUE IF NOT EXISTS 'ADMIN';
ALTER TYPE "OrganizationRole" ADD VALUE IF NOT EXISTS 'RESEARCHER';
ALTER TYPE "OrganizationRole" ADD VALUE IF NOT EXISTS 'VIEWER';

CREATE TYPE "AuthenticationChallengePurpose" AS ENUM (
  'MFA_LOGIN', 'MFA_ENROLLMENT', 'PASSWORD_RESET'
);
CREATE TYPE "SecurityAuditEventType" AS ENUM (
  'LOGIN_SUCCESS', 'LOGIN_FAILURE', 'ACCOUNT_LOCKED', 'ACCOUNT_UNLOCKED',
  'PASSWORD_CHANGED', 'PASSWORD_EXPIRED', 'MFA_ENROLLED', 'MFA_DISABLED',
  'MFA_CHALLENGE_FAILED', 'RECOVERY_CODE_USED', 'USER_CREATED', 'USER_DISABLED',
  'ROLE_CHANGED', 'ACCESS_REVIEW_COMPLETED', 'PROVIDER_CONNECTED',
  'PROVIDER_DISCONNECTED', 'CREDENTIAL_ROTATED', 'SESSION_REVOKED'
);
CREATE TYPE "AccessReviewDecision" AS ENUM (
  'APPROVED', 'REMOVE_ACCESS', 'CHANGE_ROLE'
);
CREATE TYPE "CredentialRotationType" AS ENUM (
  'SP_API_LWA_CLIENT_SECRET', 'SP_API_REFRESH_TOKEN',
  'PROVIDER_ENCRYPTION_KEY', 'MFA_ENCRYPTION_KEY'
);

ALTER TABLE "users"
  ADD COLUMN "first_name" TEXT,
  ADD COLUMN "last_name" TEXT,
  ADD COLUMN "password_changed_at" TIMESTAMP(3),
  ADD COLUMN "password_expires_at" TIMESTAMP(3),
  ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "deactivated_at" TIMESTAMP(3),
  ADD COLUMN "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "last_failed_login_at" TIMESTAMP(3),
  ADD COLUMN "locked_until" TIMESTAMP(3),
  ADD COLUMN "last_authenticated_at" TIMESTAMP(3);

UPDATE "users"
SET
  "password_changed_at" = "created_at",
  "password_expires_at" = "created_at" + INTERVAL '365 days',
  "must_change_password" = true;

ALTER TABLE "users"
  ALTER COLUMN "password_changed_at" SET NOT NULL,
  ALTER COLUMN "password_changed_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "password_expires_at" SET NOT NULL;

ALTER TABLE "organization_memberships"
  ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "deactivated_at" TIMESTAMP(3);
CREATE UNIQUE INDEX "organization_memberships_id_organization_id_key"
  ON "organization_memberships"("id", "organization_id");

CREATE TABLE "user_password_history" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_password_history_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_password_history_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "user_password_history_user_id_used_at_idx"
  ON "user_password_history"("user_id", "used_at" DESC);
INSERT INTO "user_password_history" ("id", "user_id", "password_hash", "used_at")
SELECT concat('migrated_', "id"), "id", "password_hash", "password_changed_at"
FROM "users";

CREATE TABLE "user_mfa_factors" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "encrypted_secret" TEXT NOT NULL,
  "encryption_nonce" TEXT NOT NULL,
  "encryption_tag" TEXT NOT NULL,
  "encryption_key_version" INTEGER NOT NULL,
  "confirmed_at" TIMESTAMP(3),
  "disabled_at" TIMESTAMP(3),
  "last_used_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "user_mfa_factors_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_mfa_factors_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "user_mfa_factors_user_id_key" ON "user_mfa_factors"("user_id");

CREATE TABLE "user_mfa_recovery_codes" (
  "id" TEXT NOT NULL,
  "factor_id" TEXT NOT NULL,
  "code_hash" TEXT NOT NULL,
  "used_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_mfa_recovery_codes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_mfa_recovery_codes_factor_id_fkey" FOREIGN KEY ("factor_id")
    REFERENCES "user_mfa_factors"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "user_mfa_recovery_codes_factor_id_used_at_idx"
  ON "user_mfa_recovery_codes"("factor_id", "used_at");

CREATE TABLE "authentication_challenges" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "purpose" "AuthenticationChallengePurpose" NOT NULL,
  "failed_attempts" INTEGER NOT NULL DEFAULT 0,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "consumed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "authentication_challenges_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "authentication_challenges_organization_id_fkey" FOREIGN KEY ("organization_id")
    REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "authentication_challenges_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "authentication_challenges_token_hash_key"
  ON "authentication_challenges"("token_hash");
CREATE INDEX "authentication_challenges_org_user_purpose_expiry_idx"
  ON "authentication_challenges"("organization_id", "user_id", "purpose", "expires_at");
CREATE INDEX "authentication_challenges_expiry_consumed_idx"
  ON "authentication_challenges"("expires_at", "consumed_at");

CREATE TABLE "user_sessions" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "session_epoch" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "revoked_at" TIMESTAMP(3),
  "revoked_reason" TEXT,
  CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_sessions_organization_id_fkey" FOREIGN KEY ("organization_id")
    REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "user_sessions_id_organization_id_key"
  ON "user_sessions"("id", "organization_id");
CREATE INDEX "user_sessions_user_id_revoked_at_expires_at_idx"
  ON "user_sessions"("user_id", "revoked_at", "expires_at");
CREATE INDEX "user_sessions_organization_id_last_seen_at_idx"
  ON "user_sessions"("organization_id", "last_seen_at");

CREATE TABLE "organization_access_reviews" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "membership_id" TEXT NOT NULL,
  "subject_user_id" TEXT NOT NULL,
  "reviewer_user_id" TEXT NOT NULL,
  "decision" "AccessReviewDecision" NOT NULL,
  "reviewed_role" "OrganizationRole" NOT NULL,
  "requested_role" "OrganizationRole",
  "reason" TEXT NOT NULL,
  "reviewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "next_review_due_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "organization_access_reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "organization_access_reviews_organization_id_fkey" FOREIGN KEY ("organization_id")
    REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "organization_access_reviews_membership_org_fkey" FOREIGN KEY ("membership_id", "organization_id")
    REFERENCES "organization_memberships"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "organization_access_reviews_subject_user_id_fkey" FOREIGN KEY ("subject_user_id")
    REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "organization_access_reviews_reviewer_user_id_fkey" FOREIGN KEY ("reviewer_user_id")
    REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "organization_access_reviews_org_subject_reviewed_idx"
  ON "organization_access_reviews"("organization_id", "subject_user_id", "reviewed_at" DESC);
CREATE INDEX "organization_access_reviews_org_next_due_idx"
  ON "organization_access_reviews"("organization_id", "next_review_due_at");

CREATE TABLE "security_audit_events" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "actor_user_id" TEXT,
  "target_user_id" TEXT,
  "event_type" "SecurityAuditEventType" NOT NULL,
  "idempotency_key" TEXT,
  "context" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "security_audit_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "security_audit_events_organization_id_fkey" FOREIGN KEY ("organization_id")
    REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "security_audit_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id")
    REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "security_audit_events_target_user_id_fkey" FOREIGN KEY ("target_user_id")
    REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "security_audit_events_org_type_created_idx"
  ON "security_audit_events"("organization_id", "event_type", "created_at" DESC);
CREATE UNIQUE INDEX "security_audit_events_org_idempotency_key"
  ON "security_audit_events"("organization_id", "idempotency_key");
CREATE INDEX "security_audit_events_target_created_idx"
  ON "security_audit_events"("target_user_id", "created_at" DESC);

CREATE TABLE "credential_rotation_records" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "actor_user_id" TEXT,
  "credential_type" "CredentialRotationType" NOT NULL,
  "key_version" INTEGER,
  "rotated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "next_due_at" TIMESTAMP(3) NOT NULL,
  "notes" TEXT,
  CONSTRAINT "credential_rotation_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "credential_rotation_records_organization_id_fkey" FOREIGN KEY ("organization_id")
    REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "credential_rotation_records_actor_user_id_fkey" FOREIGN KEY ("actor_user_id")
    REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "credential_rotation_records_org_type_rotated_idx"
  ON "credential_rotation_records"("organization_id", "credential_type", "rotated_at" DESC);
CREATE INDEX "credential_rotation_records_org_next_due_idx"
  ON "credential_rotation_records"("organization_id", "next_due_at");
