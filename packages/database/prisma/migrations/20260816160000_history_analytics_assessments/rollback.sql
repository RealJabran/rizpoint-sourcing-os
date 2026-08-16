-- Local/disposable rollback only: removes derived snapshots, never raw history.
ALTER TABLE "history_analytics_assessments"
  DROP CONSTRAINT IF EXISTS "history_analytics_assessments_catalog_product_fkey";
ALTER TABLE "history_analytics_assessments"
  DROP CONSTRAINT IF EXISTS "history_analytics_assessments_organization_fkey";
DROP TABLE IF EXISTS "history_analytics_assessments";
DROP TYPE IF EXISTS "HistoryAnalyticsStatus";
