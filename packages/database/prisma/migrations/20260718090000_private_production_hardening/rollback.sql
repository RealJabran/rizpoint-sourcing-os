-- Destructive rollback. Take and verify a production backup first.
ALTER TABLE "organization_memberships" DROP CONSTRAINT IF EXISTS "organization_memberships_user_id_fkey";
ALTER TABLE "organization_memberships" DROP CONSTRAINT IF EXISTS "organization_memberships_organization_id_fkey";
DROP TABLE IF EXISTS "organization_memberships";
DROP TABLE IF EXISTS "users";
DROP TYPE IF EXISTS "OrganizationRole";
