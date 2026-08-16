-- Additive research-domain foundation. Existing wholesale tables and indexes
-- are intentionally unchanged.
-- CreateEnum
CREATE TYPE "ResearchProjectMode" AS ENUM ('PRIVATE_LABEL', 'WHOLESALE', 'MANUAL_ASIN');

-- CreateEnum
CREATE TYPE "ResearchProjectStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ResearchItemKind" AS ENUM ('PRODUCT', 'MARKET', 'KEYWORD', 'CATEGORY', 'BRAND', 'SELLER');

-- CreateEnum
CREATE TYPE "ResearchWatchStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MarketMembershipMode" AS ENUM ('FROZEN', 'DYNAMIC');

-- CreateEnum
CREATE TYPE "MarketMemberSource" AS ENUM ('MANUAL', 'KEYWORD', 'CATEGORY', 'PROVIDER', 'DERIVED');

-- CreateEnum
CREATE TYPE "ResearchObservationType" AS ENUM ('KEYWORD', 'PRODUCT_KEYWORD', 'PRODUCT_MARKET', 'MARKET', 'CATEGORY', 'BRAND', 'SELLER');

-- CreateEnum
CREATE TYPE "ResearchObservationCompleteness" AS ENUM ('COMPLETE', 'PARTIAL', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "HistoricalSubjectType" AS ENUM ('PRODUCT', 'KEYWORD', 'MARKET', 'CATEGORY', 'BRAND', 'SELLER');

-- CreateEnum
CREATE TYPE "OpportunityAssessmentStatus" AS ENUM ('COMPLETE', 'PARTIAL', 'INSUFFICIENT_DATA');

-- CreateEnum
CREATE TYPE "OpportunityRecommendation" AS ENUM ('PURSUE', 'WATCH', 'REVIEW', 'REJECT', 'INSUFFICIENT_DATA');

-- CreateEnum
CREATE TYPE "OpportunityReasonKind" AS ENUM ('POSITIVE', 'NEGATIVE', 'WARNING', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "AlertRuleStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AlertOperator" AS ENUM ('GREATER_THAN', 'GREATER_THAN_OR_EQUAL', 'LESS_THAN', 'LESS_THAN_OR_EQUAL', 'EQUAL', 'CHANGED');

-- CreateEnum
CREATE TYPE "AlertEventStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateTable
CREATE TABLE "research_projects" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "mode" "ResearchProjectMode" NOT NULL,
    "status" "ResearchProjectStatus" NOT NULL DEFAULT 'ACTIVE',
    "marketplace_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "research_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_tags" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "normalized_label" TEXT NOT NULL,
    "color_token" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "research_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_project_tags" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "tag_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "research_project_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_project_items" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "kind" "ResearchItemKind" NOT NULL,
    "subject_key" TEXT NOT NULL,
    "catalog_product_id" TEXT,
    "market_definition_id" TEXT,
    "keyword_id" TEXT,
    "display_label" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "research_project_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_notes" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "project_item_id" TEXT,
    "body" TEXT NOT NULL,
    "evidence_refs" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "research_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_watches" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT,
    "catalog_product_id" TEXT NOT NULL,
    "marketplace_id" TEXT NOT NULL,
    "status" "ResearchWatchStatus" NOT NULL DEFAULT 'ACTIVE',
    "cadence_minutes" INTEGER NOT NULL,
    "next_observation_at" TIMESTAMP(3),
    "last_observed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_watches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_definitions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT,
    "name" TEXT NOT NULL,
    "marketplace_id" TEXT NOT NULL,
    "membership_mode" "MarketMembershipMode" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "definition" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "market_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_members" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "market_definition_id" TEXT NOT NULL,
    "catalog_product_id" TEXT NOT NULL,
    "source" "MarketMemberSource" NOT NULL,
    "evidence_refs" JSONB,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMP(3),

    CONSTRAINT "market_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "keywords" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "marketplace_id" TEXT NOT NULL,
    "phrase" TEXT NOT NULL,
    "normalized_phrase" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "keywords_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_observations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "marketplace_id" TEXT NOT NULL,
    "type" "ResearchObservationType" NOT NULL,
    "provider_key" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "observation_key" TEXT NOT NULL,
    "provider_reference" TEXT,
    "observed_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3),
    "freshness_state" "ExternalFreshnessState" NOT NULL,
    "completeness" "ResearchObservationCompleteness" NOT NULL,
    "status" "ProviderObservationStatus" NOT NULL,
    "request_hash" TEXT,
    "request_inputs" JSONB,
    "raw_evidence_reference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "research_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "keyword_observations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "observation_id" TEXT NOT NULL,
    "keyword_id" TEXT NOT NULL,
    "search_volume" DECIMAL(20,4),
    "competing_product_count" BIGINT,
    "suggested_bid" DECIMAL(18,4),
    "currency" TEXT,
    "metrics" JSONB,

    CONSTRAINT "keyword_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_keyword_observations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "observation_id" TEXT NOT NULL,
    "catalog_product_id" TEXT NOT NULL,
    "keyword_id" TEXT NOT NULL,
    "organic_rank" INTEGER,
    "sponsored_rank" INTEGER,
    "relevance_score" DECIMAL(12,4),
    "metrics" JSONB,

    CONSTRAINT "product_keyword_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_market_observations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "observation_id" TEXT NOT NULL,
    "catalog_product_id" TEXT NOT NULL,
    "market_definition_id" TEXT NOT NULL,
    "market_position" INTEGER,
    "share_estimate" DECIMAL(12,4),
    "metrics" JSONB,

    CONSTRAINT "product_market_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_observations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "observation_id" TEXT NOT NULL,
    "market_definition_id" TEXT NOT NULL,
    "member_count" INTEGER,
    "estimated_revenue" DECIMAL(20,4),
    "currency" TEXT,
    "concentration_index" DECIMAL(12,4),
    "metrics" JSONB,

    CONSTRAINT "market_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_observations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "observation_id" TEXT NOT NULL,
    "category_reference" TEXT NOT NULL,
    "category_name" TEXT,
    "parent_category_reference" TEXT,
    "product_count" BIGINT,
    "metrics" JSONB,

    CONSTRAINT "category_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_observations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "observation_id" TEXT NOT NULL,
    "brand_key" TEXT NOT NULL,
    "display_name" TEXT,
    "product_count" BIGINT,
    "seller_count" BIGINT,
    "resolution_score" DECIMAL(12,4),
    "metrics" JSONB,

    CONSTRAINT "brand_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_observations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "observation_id" TEXT NOT NULL,
    "seller_reference" TEXT NOT NULL,
    "display_name" TEXT,
    "amazon_retail_presence" "OfferPresence" NOT NULL DEFAULT 'UNKNOWN',
    "product_count" BIGINT,
    "metrics" JSONB,

    CONSTRAINT "seller_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "historical_metric_series" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "marketplace_id" TEXT NOT NULL,
    "subject_type" "HistoricalSubjectType" NOT NULL,
    "subject_key" TEXT NOT NULL,
    "catalog_product_id" TEXT,
    "keyword_id" TEXT,
    "market_definition_id" TEXT,
    "metric_key" TEXT NOT NULL,
    "provider_key" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "currency" TEXT,
    "retention_days" INTEGER NOT NULL DEFAULT 730,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "historical_metric_series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "historical_metric_points" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "series_id" TEXT NOT NULL,
    "source_observation_id" TEXT NOT NULL,
    "metric_at" TIMESTAMP(3) NOT NULL,
    "decimal_value" DECIMAL(30,10),
    "integer_value" BIGINT,
    "boolean_value" BOOLEAN,
    "text_value" TEXT,
    "is_interpolated" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "historical_metric_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunity_assessments" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "project_item_id" TEXT,
    "catalog_product_id" TEXT,
    "market_definition_id" TEXT,
    "marketplace_id" TEXT NOT NULL,
    "status" "OpportunityAssessmentStatus" NOT NULL,
    "recommendation" "OpportunityRecommendation" NOT NULL,
    "score" DECIMAL(12,4),
    "calculation_version" TEXT NOT NULL,
    "input_observation_references" JSONB NOT NULL,
    "calculated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opportunity_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunity_reasons" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "assessment_id" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "OpportunityReasonKind" NOT NULL,
    "message" TEXT NOT NULL,
    "weight" DECIMAL(12,4),
    "evidence_refs" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opportunity_reasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_rules" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT,
    "marketplace_id" TEXT NOT NULL,
    "subject_type" "HistoricalSubjectType" NOT NULL,
    "subject_key" TEXT NOT NULL,
    "metric_key" TEXT NOT NULL,
    "operator" "AlertOperator" NOT NULL,
    "threshold" DECIMAL(30,10),
    "status" "AlertRuleStatus" NOT NULL DEFAULT 'ACTIVE',
    "cooldown_minutes" INTEGER NOT NULL DEFAULT 60,
    "last_evaluated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alert_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_events" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "alert_rule_id" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "status" "AlertEventStatus" NOT NULL DEFAULT 'OPEN',
    "source_observation_refs" JSONB NOT NULL,
    "observed_at" TIMESTAMP(3) NOT NULL,
    "triggered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "payload" JSONB,

    CONSTRAINT "alert_events_pkey" PRIMARY KEY ("id")
);

-- Tenant-safe polymorphic references retain a typed foreign key wherever a
-- canonical entity exists. Category, brand, and seller subjects use the
-- explicit subject_key until a licensed source establishes canonical truth.
ALTER TABLE "research_project_items"
  ADD CONSTRAINT "research_project_items_typed_subject_check" CHECK (
    ("kind" = 'PRODUCT' AND "catalog_product_id" IS NOT NULL AND "market_definition_id" IS NULL AND "keyword_id" IS NULL) OR
    ("kind" = 'MARKET' AND "catalog_product_id" IS NULL AND "market_definition_id" IS NOT NULL AND "keyword_id" IS NULL) OR
    ("kind" = 'KEYWORD' AND "catalog_product_id" IS NULL AND "market_definition_id" IS NULL AND "keyword_id" IS NOT NULL) OR
    ("kind" IN ('CATEGORY', 'BRAND', 'SELLER') AND "catalog_product_id" IS NULL AND "market_definition_id" IS NULL AND "keyword_id" IS NULL)
  );

ALTER TABLE "historical_metric_series"
  ADD CONSTRAINT "historical_metric_series_typed_subject_check" CHECK (
    ("subject_type" = 'PRODUCT' AND "catalog_product_id" IS NOT NULL AND "keyword_id" IS NULL AND "market_definition_id" IS NULL) OR
    ("subject_type" = 'KEYWORD' AND "catalog_product_id" IS NULL AND "keyword_id" IS NOT NULL AND "market_definition_id" IS NULL) OR
    ("subject_type" = 'MARKET' AND "catalog_product_id" IS NULL AND "keyword_id" IS NULL AND "market_definition_id" IS NOT NULL) OR
    ("subject_type" IN ('CATEGORY', 'BRAND', 'SELLER') AND "catalog_product_id" IS NULL AND "keyword_id" IS NULL AND "market_definition_id" IS NULL)
  ),
  ADD CONSTRAINT "historical_metric_series_retention_days_check" CHECK ("retention_days" > 0);

ALTER TABLE "historical_metric_points"
  ADD CONSTRAINT "historical_metric_points_single_value_check" CHECK (
    num_nonnulls("decimal_value", "integer_value", "boolean_value", "text_value") = 1
  );

ALTER TABLE "research_observations"
  ADD CONSTRAINT "research_observations_freshness_window_check" CHECK (
    "expires_at" IS NULL OR "expires_at" >= "observed_at"
  );

ALTER TABLE "product_watches"
  ADD CONSTRAINT "product_watches_cadence_check" CHECK ("cadence_minutes" > 0);

ALTER TABLE "market_members"
  ADD CONSTRAINT "market_members_window_check" CHECK ("left_at" IS NULL OR "left_at" >= "joined_at");

ALTER TABLE "opportunity_assessments"
  ADD CONSTRAINT "opportunity_assessments_input_refs_check" CHECK (
    jsonb_typeof("input_observation_references") = 'array' AND
    length(trim("calculation_version")) > 0
  );

ALTER TABLE "opportunity_reasons"
  ADD CONSTRAINT "opportunity_reasons_evidence_refs_check" CHECK (
    jsonb_typeof("evidence_refs") = 'array'
  );

ALTER TABLE "alert_rules"
  ADD CONSTRAINT "alert_rules_cooldown_check" CHECK ("cooldown_minutes" > 0);

-- CreateIndex
CREATE INDEX "research_projects_organization_id_status_updated_at_idx" ON "research_projects"("organization_id", "status", "updated_at");

-- CreateIndex
CREATE INDEX "research_projects_organization_id_marketplace_id_mode_idx" ON "research_projects"("organization_id", "marketplace_id", "mode");

-- CreateIndex
CREATE UNIQUE INDEX "research_projects_id_organization_id_key" ON "research_projects"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "research_tags_id_organization_id_key" ON "research_tags"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "research_tags_organization_id_normalized_label_key" ON "research_tags"("organization_id", "normalized_label");

-- CreateIndex
CREATE INDEX "research_project_tags_organization_id_tag_id_idx" ON "research_project_tags"("organization_id", "tag_id");

-- CreateIndex
CREATE UNIQUE INDEX "research_project_tags_project_id_tag_id_key" ON "research_project_tags"("project_id", "tag_id");

-- CreateIndex
CREATE INDEX "research_project_items_organization_id_kind_updated_at_idx" ON "research_project_items"("organization_id", "kind", "updated_at");

-- CreateIndex
CREATE INDEX "research_project_items_catalog_product_id_idx" ON "research_project_items"("catalog_product_id");

-- CreateIndex
CREATE INDEX "research_project_items_market_definition_id_idx" ON "research_project_items"("market_definition_id");

-- CreateIndex
CREATE INDEX "research_project_items_keyword_id_idx" ON "research_project_items"("keyword_id");

-- CreateIndex
CREATE UNIQUE INDEX "research_project_items_id_organization_id_key" ON "research_project_items"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "research_project_items_project_id_kind_subject_key_key" ON "research_project_items"("project_id", "kind", "subject_key");

-- CreateIndex
CREATE INDEX "research_notes_organization_id_project_id_created_at_idx" ON "research_notes"("organization_id", "project_id", "created_at");

-- CreateIndex
CREATE INDEX "research_notes_project_item_id_idx" ON "research_notes"("project_item_id");

-- CreateIndex
CREATE INDEX "product_watches_organization_id_status_next_observation_at_idx" ON "product_watches"("organization_id", "status", "next_observation_at");

-- CreateIndex
CREATE INDEX "product_watches_project_id_idx" ON "product_watches"("project_id");

-- CreateIndex
CREATE INDEX "product_watches_catalog_product_id_idx" ON "product_watches"("catalog_product_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_watches_organization_id_marketplace_id_catalog_prod_key" ON "product_watches"("organization_id", "marketplace_id", "catalog_product_id");

-- CreateIndex
CREATE INDEX "market_definitions_organization_id_marketplace_id_updated_a_idx" ON "market_definitions"("organization_id", "marketplace_id", "updated_at");

-- CreateIndex
CREATE INDEX "market_definitions_project_id_idx" ON "market_definitions"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "market_definitions_id_organization_id_key" ON "market_definitions"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "market_definitions_organization_id_marketplace_id_name_vers_key" ON "market_definitions"("organization_id", "marketplace_id", "name", "version");

-- CreateIndex
CREATE INDEX "market_members_organization_id_market_definition_id_left_at_idx" ON "market_members"("organization_id", "market_definition_id", "left_at");

-- CreateIndex
CREATE INDEX "market_members_catalog_product_id_idx" ON "market_members"("catalog_product_id");

-- CreateIndex
CREATE UNIQUE INDEX "market_members_market_definition_id_catalog_product_id_join_key" ON "market_members"("market_definition_id", "catalog_product_id", "joined_at");

-- CreateIndex
CREATE INDEX "keywords_organization_id_marketplace_id_updated_at_idx" ON "keywords"("organization_id", "marketplace_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "keywords_id_organization_id_key" ON "keywords"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "keywords_organization_id_marketplace_id_locale_normalized_p_key" ON "keywords"("organization_id", "marketplace_id", "locale", "normalized_phrase");

-- CreateIndex
CREATE INDEX "research_observations_organization_id_marketplace_id_type_o_idx" ON "research_observations"("organization_id", "marketplace_id", "type", "observed_at");

-- CreateIndex
CREATE INDEX "research_observations_organization_id_freshness_state_expir_idx" ON "research_observations"("organization_id", "freshness_state", "expires_at");

-- CreateIndex
CREATE INDEX "research_observations_provider_key_operation_observed_at_idx" ON "research_observations"("provider_key", "operation", "observed_at");

-- CreateIndex
CREATE UNIQUE INDEX "research_observations_id_organization_id_key" ON "research_observations"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "research_observations_organization_id_provider_key_marketpl_key" ON "research_observations"("organization_id", "provider_key", "marketplace_id", "type", "observation_key", "observed_at");

-- CreateIndex
CREATE INDEX "keyword_observations_organization_id_keyword_id_idx" ON "keyword_observations"("organization_id", "keyword_id");

-- CreateIndex
CREATE UNIQUE INDEX "keyword_observations_observation_id_organization_id_key" ON "keyword_observations"("observation_id", "organization_id");

-- CreateIndex
CREATE INDEX "product_keyword_observations_organization_id_keyword_id_org_idx" ON "product_keyword_observations"("organization_id", "keyword_id", "organic_rank");

-- CreateIndex
CREATE INDEX "product_keyword_observations_catalog_product_id_idx" ON "product_keyword_observations"("catalog_product_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_keyword_observations_observation_id_organization_id_key" ON "product_keyword_observations"("observation_id", "organization_id");

-- CreateIndex
CREATE INDEX "product_market_observations_organization_id_market_definiti_idx" ON "product_market_observations"("organization_id", "market_definition_id", "market_position");

-- CreateIndex
CREATE INDEX "product_market_observations_catalog_product_id_idx" ON "product_market_observations"("catalog_product_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_market_observations_observation_id_organization_id_key" ON "product_market_observations"("observation_id", "organization_id");

-- CreateIndex
CREATE INDEX "market_observations_organization_id_market_definition_id_idx" ON "market_observations"("organization_id", "market_definition_id");

-- CreateIndex
CREATE UNIQUE INDEX "market_observations_observation_id_organization_id_key" ON "market_observations"("observation_id", "organization_id");

-- CreateIndex
CREATE INDEX "category_observations_organization_id_category_reference_idx" ON "category_observations"("organization_id", "category_reference");

-- CreateIndex
CREATE UNIQUE INDEX "category_observations_observation_id_organization_id_key" ON "category_observations"("observation_id", "organization_id");

-- CreateIndex
CREATE INDEX "brand_observations_organization_id_brand_key_idx" ON "brand_observations"("organization_id", "brand_key");

-- CreateIndex
CREATE UNIQUE INDEX "brand_observations_observation_id_organization_id_key" ON "brand_observations"("observation_id", "organization_id");

-- CreateIndex
CREATE INDEX "seller_observations_organization_id_seller_reference_idx" ON "seller_observations"("organization_id", "seller_reference");

-- CreateIndex
CREATE UNIQUE INDEX "seller_observations_observation_id_organization_id_key" ON "seller_observations"("observation_id", "organization_id");

-- CreateIndex
CREATE INDEX "historical_metric_series_organization_id_marketplace_id_sub_idx" ON "historical_metric_series"("organization_id", "marketplace_id", "subject_type", "subject_key");

-- CreateIndex
CREATE INDEX "historical_metric_series_catalog_product_id_idx" ON "historical_metric_series"("catalog_product_id");

-- CreateIndex
CREATE INDEX "historical_metric_series_keyword_id_idx" ON "historical_metric_series"("keyword_id");

-- CreateIndex
CREATE INDEX "historical_metric_series_market_definition_id_idx" ON "historical_metric_series"("market_definition_id");

-- CreateIndex
CREATE UNIQUE INDEX "historical_metric_series_id_organization_id_key" ON "historical_metric_series"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "historical_metric_series_organization_id_marketplace_id_sub_key" ON "historical_metric_series"("organization_id", "marketplace_id", "subject_type", "subject_key", "metric_key", "provider_key");

-- CreateIndex
CREATE INDEX "historical_metric_points_organization_id_series_id_metric_a_idx" ON "historical_metric_points"("organization_id", "series_id", "metric_at");

-- PostgreSQL remains the time-series store for the current scale. The BRIN
-- index bounds retention scans over append-ordered timestamps without adding
-- a second database. Series reads use the btree index above.
CREATE INDEX "historical_metric_points_metric_at_brin_idx"
  ON "historical_metric_points" USING BRIN ("metric_at");

-- CreateIndex
CREATE INDEX "historical_metric_points_source_observation_id_idx" ON "historical_metric_points"("source_observation_id");

-- CreateIndex
CREATE UNIQUE INDEX "historical_metric_points_series_id_source_observation_id_me_key" ON "historical_metric_points"("series_id", "source_observation_id", "metric_at");

-- CreateIndex
CREATE INDEX "opportunity_assessments_organization_id_project_id_calculat_idx" ON "opportunity_assessments"("organization_id", "project_id", "calculated_at");

-- CreateIndex
CREATE INDEX "opportunity_assessments_organization_id_recommendation_calc_idx" ON "opportunity_assessments"("organization_id", "recommendation", "calculated_at");

-- CreateIndex
CREATE INDEX "opportunity_assessments_catalog_product_id_idx" ON "opportunity_assessments"("catalog_product_id");

-- CreateIndex
CREATE INDEX "opportunity_assessments_market_definition_id_idx" ON "opportunity_assessments"("market_definition_id");

-- CreateIndex
CREATE UNIQUE INDEX "opportunity_assessments_id_organization_id_key" ON "opportunity_assessments"("id", "organization_id");

-- CreateIndex
CREATE INDEX "opportunity_reasons_organization_id_assessment_id_idx" ON "opportunity_reasons"("organization_id", "assessment_id");

-- CreateIndex
CREATE UNIQUE INDEX "opportunity_reasons_assessment_id_ordinal_key" ON "opportunity_reasons"("assessment_id", "ordinal");

-- CreateIndex
CREATE INDEX "alert_rules_organization_id_status_marketplace_id_idx" ON "alert_rules"("organization_id", "status", "marketplace_id");

-- CreateIndex
CREATE INDEX "alert_rules_project_id_idx" ON "alert_rules"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "alert_rules_id_organization_id_key" ON "alert_rules"("id", "organization_id");

-- CreateIndex
CREATE INDEX "alert_events_organization_id_status_triggered_at_idx" ON "alert_events"("organization_id", "status", "triggered_at");

-- CreateIndex
CREATE UNIQUE INDEX "alert_events_alert_rule_id_dedupe_key_key" ON "alert_events"("alert_rule_id", "dedupe_key");

-- AddForeignKey
ALTER TABLE "research_projects" ADD CONSTRAINT "research_projects_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_tags" ADD CONSTRAINT "research_tags_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_project_tags" ADD CONSTRAINT "research_project_tags_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_project_tags" ADD CONSTRAINT "research_project_tags_project_id_organization_id_fkey" FOREIGN KEY ("project_id", "organization_id") REFERENCES "research_projects"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_project_tags" ADD CONSTRAINT "research_project_tags_tag_id_organization_id_fkey" FOREIGN KEY ("tag_id", "organization_id") REFERENCES "research_tags"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_project_items" ADD CONSTRAINT "research_project_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_project_items" ADD CONSTRAINT "research_project_items_project_id_organization_id_fkey" FOREIGN KEY ("project_id", "organization_id") REFERENCES "research_projects"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_project_items" ADD CONSTRAINT "research_project_items_catalog_product_id_fkey" FOREIGN KEY ("catalog_product_id") REFERENCES "catalog_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_project_items" ADD CONSTRAINT "research_project_items_market_definition_id_organization_i_fkey" FOREIGN KEY ("market_definition_id", "organization_id") REFERENCES "market_definitions"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_project_items" ADD CONSTRAINT "research_project_items_keyword_id_organization_id_fkey" FOREIGN KEY ("keyword_id", "organization_id") REFERENCES "keywords"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_notes" ADD CONSTRAINT "research_notes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_notes" ADD CONSTRAINT "research_notes_project_id_organization_id_fkey" FOREIGN KEY ("project_id", "organization_id") REFERENCES "research_projects"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_notes" ADD CONSTRAINT "research_notes_project_item_id_organization_id_fkey" FOREIGN KEY ("project_item_id", "organization_id") REFERENCES "research_project_items"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_watches" ADD CONSTRAINT "product_watches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_watches" ADD CONSTRAINT "product_watches_project_id_organization_id_fkey" FOREIGN KEY ("project_id", "organization_id") REFERENCES "research_projects"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_watches" ADD CONSTRAINT "product_watches_catalog_product_id_fkey" FOREIGN KEY ("catalog_product_id") REFERENCES "catalog_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_definitions" ADD CONSTRAINT "market_definitions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_definitions" ADD CONSTRAINT "market_definitions_project_id_organization_id_fkey" FOREIGN KEY ("project_id", "organization_id") REFERENCES "research_projects"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_members" ADD CONSTRAINT "market_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_members" ADD CONSTRAINT "market_members_market_definition_id_organization_id_fkey" FOREIGN KEY ("market_definition_id", "organization_id") REFERENCES "market_definitions"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_members" ADD CONSTRAINT "market_members_catalog_product_id_fkey" FOREIGN KEY ("catalog_product_id") REFERENCES "catalog_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "keywords" ADD CONSTRAINT "keywords_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_observations" ADD CONSTRAINT "research_observations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "keyword_observations" ADD CONSTRAINT "keyword_observations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "keyword_observations" ADD CONSTRAINT "keyword_observations_observation_id_organization_id_fkey" FOREIGN KEY ("observation_id", "organization_id") REFERENCES "research_observations"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "keyword_observations" ADD CONSTRAINT "keyword_observations_keyword_id_organization_id_fkey" FOREIGN KEY ("keyword_id", "organization_id") REFERENCES "keywords"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_keyword_observations" ADD CONSTRAINT "product_keyword_observations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_keyword_observations" ADD CONSTRAINT "product_keyword_observations_observation_id_organization_i_fkey" FOREIGN KEY ("observation_id", "organization_id") REFERENCES "research_observations"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_keyword_observations" ADD CONSTRAINT "product_keyword_observations_catalog_product_id_fkey" FOREIGN KEY ("catalog_product_id") REFERENCES "catalog_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_keyword_observations" ADD CONSTRAINT "product_keyword_observations_keyword_id_organization_id_fkey" FOREIGN KEY ("keyword_id", "organization_id") REFERENCES "keywords"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_market_observations" ADD CONSTRAINT "product_market_observations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_market_observations" ADD CONSTRAINT "product_market_observations_observation_id_organization_id_fkey" FOREIGN KEY ("observation_id", "organization_id") REFERENCES "research_observations"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_market_observations" ADD CONSTRAINT "product_market_observations_catalog_product_id_fkey" FOREIGN KEY ("catalog_product_id") REFERENCES "catalog_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_market_observations" ADD CONSTRAINT "product_market_observations_market_definition_id_organizat_fkey" FOREIGN KEY ("market_definition_id", "organization_id") REFERENCES "market_definitions"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_observations" ADD CONSTRAINT "market_observations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_observations" ADD CONSTRAINT "market_observations_observation_id_organization_id_fkey" FOREIGN KEY ("observation_id", "organization_id") REFERENCES "research_observations"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_observations" ADD CONSTRAINT "market_observations_market_definition_id_organization_id_fkey" FOREIGN KEY ("market_definition_id", "organization_id") REFERENCES "market_definitions"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_observations" ADD CONSTRAINT "category_observations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_observations" ADD CONSTRAINT "category_observations_observation_id_organization_id_fkey" FOREIGN KEY ("observation_id", "organization_id") REFERENCES "research_observations"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_observations" ADD CONSTRAINT "brand_observations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_observations" ADD CONSTRAINT "brand_observations_observation_id_organization_id_fkey" FOREIGN KEY ("observation_id", "organization_id") REFERENCES "research_observations"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_observations" ADD CONSTRAINT "seller_observations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_observations" ADD CONSTRAINT "seller_observations_observation_id_organization_id_fkey" FOREIGN KEY ("observation_id", "organization_id") REFERENCES "research_observations"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historical_metric_series" ADD CONSTRAINT "historical_metric_series_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historical_metric_series" ADD CONSTRAINT "historical_metric_series_catalog_product_id_fkey" FOREIGN KEY ("catalog_product_id") REFERENCES "catalog_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historical_metric_series" ADD CONSTRAINT "historical_metric_series_keyword_id_organization_id_fkey" FOREIGN KEY ("keyword_id", "organization_id") REFERENCES "keywords"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historical_metric_series" ADD CONSTRAINT "historical_metric_series_market_definition_id_organization_fkey" FOREIGN KEY ("market_definition_id", "organization_id") REFERENCES "market_definitions"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historical_metric_points" ADD CONSTRAINT "historical_metric_points_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historical_metric_points" ADD CONSTRAINT "historical_metric_points_series_id_organization_id_fkey" FOREIGN KEY ("series_id", "organization_id") REFERENCES "historical_metric_series"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historical_metric_points" ADD CONSTRAINT "historical_metric_points_source_observation_id_organizatio_fkey" FOREIGN KEY ("source_observation_id", "organization_id") REFERENCES "research_observations"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_assessments" ADD CONSTRAINT "opportunity_assessments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_assessments" ADD CONSTRAINT "opportunity_assessments_project_id_organization_id_fkey" FOREIGN KEY ("project_id", "organization_id") REFERENCES "research_projects"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_assessments" ADD CONSTRAINT "opportunity_assessments_project_item_id_organization_id_fkey" FOREIGN KEY ("project_item_id", "organization_id") REFERENCES "research_project_items"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_assessments" ADD CONSTRAINT "opportunity_assessments_catalog_product_id_fkey" FOREIGN KEY ("catalog_product_id") REFERENCES "catalog_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_assessments" ADD CONSTRAINT "opportunity_assessments_market_definition_id_organization__fkey" FOREIGN KEY ("market_definition_id", "organization_id") REFERENCES "market_definitions"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_reasons" ADD CONSTRAINT "opportunity_reasons_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_reasons" ADD CONSTRAINT "opportunity_reasons_assessment_id_organization_id_fkey" FOREIGN KEY ("assessment_id", "organization_id") REFERENCES "opportunity_assessments"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_project_id_organization_id_fkey" FOREIGN KEY ("project_id", "organization_id") REFERENCES "research_projects"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_alert_rule_id_organization_id_fkey" FOREIGN KEY ("alert_rule_id", "organization_id") REFERENCES "alert_rules"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
