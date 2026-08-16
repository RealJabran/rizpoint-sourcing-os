-- Strengthen Prompt 04 tenant isolation without rewriting the original
-- history migration: an item must belong to a refresh run in the same org.
CREATE UNIQUE INDEX "history_refresh_runs_id_organization_id_key"
  ON "history_refresh_runs"("id", "organization_id");

ALTER TABLE "history_refresh_items"
  DROP CONSTRAINT "history_refresh_items_run_fkey";

ALTER TABLE "history_refresh_items"
  ADD CONSTRAINT "history_refresh_items_run_org_fkey"
  FOREIGN KEY ("history_refresh_run_id", "organization_id")
  REFERENCES "history_refresh_runs"("id", "organization_id")
  ON DELETE CASCADE ON UPDATE CASCADE;
