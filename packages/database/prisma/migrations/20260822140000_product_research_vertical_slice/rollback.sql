ALTER TABLE "outbox_events"
DROP CONSTRAINT IF EXISTS "outbox_events_product_research_run_id_fkey";

DROP INDEX IF EXISTS "outbox_events_product_research_run_id_event_type_key";

ALTER TABLE "outbox_events"
DROP COLUMN IF EXISTS "product_research_run_id";

DROP TABLE IF EXISTS "product_research_run_items";
DROP TABLE IF EXISTS "product_research_runs";
DROP TYPE IF EXISTS "ProductResearchRunStatus";
DROP TYPE IF EXISTS "ProductResearchRunKind";
