ALTER TYPE "ScanJobStatus" ADD VALUE IF NOT EXISTS 'MATCHING';
ALTER TYPE "MappingTarget" ADD VALUE IF NOT EXISTS 'MPN';

CREATE TYPE "IdentifierType" AS ENUM ('ASIN', 'UPC', 'EAN', 'GTIN', 'MPN');
CREATE TYPE "CandidateSource" AS ENUM ('SUPPLIED_ASIN', 'EXACT_IDENTIFIER', 'MPN_BRAND', 'TITLE_SEARCH');
CREATE TYPE "MatchDecisionStatus" AS ENUM ('AUTO_ACCEPTED', 'REVIEW_REQUIRED', 'UNMATCHED', 'USER_ACCEPTED', 'USER_REJECTED');
CREATE TYPE "MatchEvidenceFeature" AS ENUM ('IDENTIFIER', 'BRAND', 'MODEL', 'SIZE', 'PACK', 'VARIATION', 'TITLE');
CREATE TYPE "MatchEvidenceOutcome" AS ENUM ('AGREEMENT', 'CONTRADICTION', 'UNKNOWN', 'NOT_APPLICABLE');
CREATE TYPE "DecisionSource" AS ENUM ('SYSTEM', 'HUMAN');
CREATE TYPE "LookupStatus" AS ENUM ('COMPLETED', 'FAILED');
CREATE TYPE "ExternalFreshnessState" AS ENUM ('FRESH', 'STALE', 'EXPIRED', 'UNKNOWN');
CREATE TYPE "PackGuardStatus" AS ENUM ('VERIFIED', 'BLOCKED_PACK_UNCERTAIN', 'BLOCKED_PACK_CONTRADICTION');

ALTER TABLE "normalized_offers" ADD COLUMN "mpn" TEXT;

CREATE TABLE "catalog_products" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "provider_reference" TEXT NOT NULL,
  "asin" TEXT,
  "title" TEXT NOT NULL,
  "brand" TEXT,
  "model" TEXT,
  "mpn" TEXT,
  "size_text" TEXT,
  "pack_count" INTEGER,
  "variation" TEXT,
  "observed_at" TIMESTAMP(3) NOT NULL,
  "freshness_state" "ExternalFreshnessState" NOT NULL,
  "raw_payload" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "catalog_products_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "product_identifiers" (
  "id" TEXT NOT NULL,
  "catalog_product_id" TEXT NOT NULL,
  "type" "IdentifierType" NOT NULL,
  "value" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_identifiers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "match_lookups" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "scan_job_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "lookup_type" "CandidateSource" NOT NULL,
  "lookup_key" TEXT NOT NULL,
  "status" "LookupStatus" NOT NULL,
  "response_checksum" TEXT,
  "payload" JSONB,
  "observed_at" TIMESTAMP(3),
  "freshness_state" "ExternalFreshnessState",
  "error_code" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "match_lookups_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "listing_candidates" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "supplier_row_id" TEXT NOT NULL,
  "catalog_product_id" TEXT NOT NULL,
  "source" "CandidateSource" NOT NULL,
  "confidence" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "listing_candidates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "match_evidence" (
  "id" TEXT NOT NULL,
  "listing_candidate_id" TEXT NOT NULL,
  "feature" "MatchEvidenceFeature" NOT NULL,
  "outcome" "MatchEvidenceOutcome" NOT NULL,
  "score" INTEGER NOT NULL,
  "reason_code" TEXT NOT NULL,
  "details" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "match_evidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "match_decisions" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "supplier_row_id" TEXT NOT NULL,
  "selected_candidate_id" TEXT,
  "status" "MatchDecisionStatus" NOT NULL,
  "confidence" INTEGER NOT NULL,
  "reason_codes" JSONB NOT NULL,
  "source" "DecisionSource" NOT NULL,
  "reviewed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "match_decisions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pack_guard_results" (
  "id" TEXT NOT NULL,
  "listing_candidate_id" TEXT NOT NULL,
  "status" "PackGuardStatus" NOT NULL,
  "supplier_units_per_case" INTEGER,
  "amazon_units_per_pack" INTEGER,
  "sellable_units_per_case" INTEGER,
  "remainder_units" INTEGER,
  "cost_per_sellable_unit" DECIMAL(18,4),
  "reason_code" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "pack_guard_results_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "catalog_products_provider_provider_reference_key" ON "catalog_products"("provider", "provider_reference");
CREATE INDEX "catalog_products_provider_asin_idx" ON "catalog_products"("provider", "asin");
CREATE UNIQUE INDEX "product_identifiers_catalog_product_id_type_value_key" ON "product_identifiers"("catalog_product_id", "type", "value");
CREATE INDEX "product_identifiers_type_value_idx" ON "product_identifiers"("type", "value");
CREATE UNIQUE INDEX "match_lookups_scan_job_id_provider_lookup_type_lookup_key_key" ON "match_lookups"("scan_job_id", "provider", "lookup_type", "lookup_key");
CREATE INDEX "match_lookups_organization_id_scan_job_id_idx" ON "match_lookups"("organization_id", "scan_job_id");
CREATE UNIQUE INDEX "listing_candidates_supplier_row_id_catalog_product_id_source_key" ON "listing_candidates"("supplier_row_id", "catalog_product_id", "source");
CREATE INDEX "listing_candidates_organization_id_supplier_row_id_idx" ON "listing_candidates"("organization_id", "supplier_row_id");
CREATE UNIQUE INDEX "match_evidence_listing_candidate_id_feature_key" ON "match_evidence"("listing_candidate_id", "feature");
CREATE UNIQUE INDEX "match_decisions_supplier_row_id_key" ON "match_decisions"("supplier_row_id");
CREATE INDEX "match_decisions_organization_id_status_updated_at_idx" ON "match_decisions"("organization_id", "status", "updated_at");
CREATE UNIQUE INDEX "pack_guard_results_listing_candidate_id_key" ON "pack_guard_results"("listing_candidate_id");

ALTER TABLE "product_identifiers" ADD CONSTRAINT "product_identifiers_catalog_product_id_fkey" FOREIGN KEY ("catalog_product_id") REFERENCES "catalog_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "match_lookups" ADD CONSTRAINT "match_lookups_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "match_lookups" ADD CONSTRAINT "match_lookups_scan_job_id_fkey" FOREIGN KEY ("scan_job_id") REFERENCES "scan_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "listing_candidates" ADD CONSTRAINT "listing_candidates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "listing_candidates" ADD CONSTRAINT "listing_candidates_supplier_row_id_fkey" FOREIGN KEY ("supplier_row_id") REFERENCES "supplier_rows"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "listing_candidates" ADD CONSTRAINT "listing_candidates_catalog_product_id_fkey" FOREIGN KEY ("catalog_product_id") REFERENCES "catalog_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "match_evidence" ADD CONSTRAINT "match_evidence_listing_candidate_id_fkey" FOREIGN KEY ("listing_candidate_id") REFERENCES "listing_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "match_decisions" ADD CONSTRAINT "match_decisions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "match_decisions" ADD CONSTRAINT "match_decisions_supplier_row_id_fkey" FOREIGN KEY ("supplier_row_id") REFERENCES "supplier_rows"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "match_decisions" ADD CONSTRAINT "match_decisions_selected_candidate_id_fkey" FOREIGN KEY ("selected_candidate_id") REFERENCES "listing_candidates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pack_guard_results" ADD CONSTRAINT "pack_guard_results_listing_candidate_id_fkey" FOREIGN KEY ("listing_candidate_id") REFERENCES "listing_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
