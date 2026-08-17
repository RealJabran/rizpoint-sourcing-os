-- Local/disposable rollback only. It removes derived score snapshots, never source observations or definitions.
ALTER TABLE "niche_assessments" DROP CONSTRAINT IF EXISTS "niche_assessments_market_definition_org_fkey";
ALTER TABLE "niche_assessments" DROP CONSTRAINT IF EXISTS "niche_assessments_organization_fkey";
DROP TABLE IF EXISTS "niche_assessments";
