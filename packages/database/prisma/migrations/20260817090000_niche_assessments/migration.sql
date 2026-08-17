-- Prompt 08: immutable, replayable Opportunity Finder score snapshots.
CREATE TABLE "niche_assessments" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "market_definition_id" TEXT NOT NULL,
  "marketplace_id" TEXT NOT NULL,
  "status" "OpportunityAssessmentStatus" NOT NULL,
  "score" DECIMAL(12,4),
  "confidence_percent" DECIMAL(9,4),
  "calculation_version" TEXT NOT NULL,
  "input_fingerprint" TEXT NOT NULL,
  "threshold_configuration" JSONB NOT NULL,
  "components" JSONB NOT NULL,
  "input_evidence_references" JSONB NOT NULL,
  "calculated_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "niche_assessments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "niche_assessments_input_key" ON "niche_assessments" (
  "organization_id", "market_definition_id", "calculation_version", "input_fingerprint"
);
CREATE INDEX "niche_assessments_org_market_calculated_idx" ON "niche_assessments" (
  "organization_id", "marketplace_id", "calculated_at"
);
CREATE INDEX "niche_assessments_market_definition_id_idx" ON "niche_assessments" ("market_definition_id");

ALTER TABLE "niche_assessments" ADD CONSTRAINT "niche_assessments_organization_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "niche_assessments" ADD CONSTRAINT "niche_assessments_market_definition_org_fkey"
  FOREIGN KEY ("market_definition_id", "organization_id") REFERENCES "market_definitions"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
