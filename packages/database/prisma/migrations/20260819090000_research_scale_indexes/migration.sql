-- Prompt 33: measured-query indexes for the existing PostgreSQL research
-- architecture. No new database or destructive table rewrite is introduced.
CREATE INDEX "listing_candidates_org_product_idx"
  ON "listing_candidates"("organization_id", "catalog_product_id");

CREATE INDEX "history_refresh_runs_due_retry_idx"
  ON "history_refresh_runs"("status", "retry_at", "id");

CREATE INDEX "history_refresh_items_org_product_idx"
  ON "history_refresh_items"("organization_id", "catalog_product_id");

CREATE INDEX "provider_observations_item_metric_status_observed_idx"
  ON "provider_observations"("enrichment_item_id", "metric_type", "observation_status", "observed_at");

CREATE INDEX "research_project_items_org_kind_product_idx"
  ON "research_project_items"("organization_id", "kind", "catalog_product_id");

CREATE INDEX "market_members_org_active_product_idx"
  ON "market_members"("organization_id", "left_at", "catalog_product_id");

CREATE INDEX "product_keyword_observations_org_product_keyword_idx"
  ON "product_keyword_observations"("organization_id", "catalog_product_id", "keyword_id");

CREATE INDEX "historical_metric_series_org_product_metric_idx"
  ON "historical_metric_series"("organization_id", "catalog_product_id", "metric_key");

CREATE INDEX "opportunity_assessments_org_product_calculated_idx"
  ON "opportunity_assessments"("organization_id", "catalog_product_id", "calculated_at");
