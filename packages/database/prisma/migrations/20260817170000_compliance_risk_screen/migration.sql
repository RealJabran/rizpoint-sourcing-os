CREATE TYPE "ComplianceRiskLevel" AS ENUM ('LOW', 'REVIEW', 'HIGH', 'UNKNOWN');
CREATE TYPE "ComplianceRuleSetStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "ComplianceRiskDomain" AS ENUM ('INGESTIBLE_FOOD_SUPPLEMENT', 'COSMETIC_TOPICAL', 'MEDICAL_HEALTH_CLAIMS', 'CHILDRENS_PRODUCT', 'BATTERY', 'RADIO_WIRELESS', 'ELECTRICAL_MAINS', 'LASER', 'PPE_SAFETY', 'CHEMICAL_HAZARDOUS_MATERIAL', 'FLAMMABLE_AEROSOL', 'AUTOMOTIVE_SAFETY', 'PET_CONSUMABLE', 'TEXTILE_APPAREL_LABELING', 'COUNTRY_ORIGIN_LABELING', 'IP_TRADEMARK_PATENT', 'AMAZON_RESTRICTED_CATEGORY');

CREATE TABLE "compliance_rule_sets" (
  "id" TEXT NOT NULL, "organization_id" TEXT NOT NULL,
  "marketplace_id" TEXT NOT NULL, "jurisdiction" TEXT NOT NULL,
  "name" TEXT NOT NULL, "version" TEXT NOT NULL,
  "source_title" TEXT NOT NULL, "source_url" TEXT NOT NULL,
  "source_published_at" TIMESTAMP(3) NOT NULL,
  "source_accessed_at" TIMESTAMP(3) NOT NULL,
  "status" "ComplianceRuleSetStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "compliance_rule_sets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "compliance_rule_sets_version" ON "compliance_rule_sets"("organization_id", "marketplace_id", "jurisdiction", "version");
CREATE INDEX "compliance_rule_sets_lookup" ON "compliance_rule_sets"("organization_id", "marketplace_id", "jurisdiction", "status", "updated_at");
ALTER TABLE "compliance_rule_sets" ADD CONSTRAINT "compliance_rule_sets_org" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "compliance_rules" (
  "id" TEXT NOT NULL, "rule_set_id" TEXT NOT NULL,
  "domain" "ComplianceRiskDomain" NOT NULL, "risk_level" "ComplianceRiskLevel" NOT NULL,
  "match_terms" JSONB NOT NULL, "rationale" TEXT NOT NULL,
  "supplier_questions" JSONB NOT NULL, "likely_documentation" JSONB NOT NULL,
  "authoritative_clearance" BOOLEAN NOT NULL DEFAULT false,
  "rule_source_title" TEXT NOT NULL, "rule_source_url" TEXT NOT NULL,
  "rule_source_published_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "compliance_rules_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "compliance_rules_domain" ON "compliance_rules"("rule_set_id", "domain");
CREATE INDEX "compliance_rules_rule_set_domain" ON "compliance_rules"("rule_set_id", "domain");
ALTER TABLE "compliance_rules" ADD CONSTRAINT "compliance_rules_rule_set" FOREIGN KEY ("rule_set_id") REFERENCES "compliance_rule_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "compliance_risk_assessments" (
  "id" TEXT NOT NULL, "organization_id" TEXT NOT NULL, "project_id" TEXT NOT NULL,
  "catalog_product_id" TEXT, "rule_set_id" TEXT NOT NULL,
  "marketplace_id" TEXT NOT NULL, "jurisdiction" TEXT NOT NULL,
  "input_text" TEXT NOT NULL, "input_fingerprint" TEXT NOT NULL,
  "results" JSONB NOT NULL, "input_evidence_references" JSONB NOT NULL,
  "calculated_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "compliance_risk_assessments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "compliance_risk_assessments_input" ON "compliance_risk_assessments"("organization_id", "project_id", "rule_set_id", "input_fingerprint");
CREATE INDEX "compliance_risk_assessments_project" ON "compliance_risk_assessments"("organization_id", "project_id", "calculated_at");
CREATE INDEX "compliance_risk_assessments_product" ON "compliance_risk_assessments"("organization_id", "catalog_product_id", "calculated_at");
ALTER TABLE "compliance_risk_assessments" ADD CONSTRAINT "compliance_risk_assessments_org" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "compliance_risk_assessments" ADD CONSTRAINT "compliance_risk_assessments_project" FOREIGN KEY ("project_id", "organization_id") REFERENCES "research_projects"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "compliance_risk_assessments" ADD CONSTRAINT "compliance_risk_assessments_product" FOREIGN KEY ("catalog_product_id") REFERENCES "catalog_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "compliance_risk_assessments" ADD CONSTRAINT "compliance_risk_assessments_rule_set" FOREIGN KEY ("rule_set_id") REFERENCES "compliance_rule_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
