ALTER TABLE "history_refresh_items"
  DROP CONSTRAINT IF EXISTS "history_refresh_items_run_org_fkey";

DROP INDEX IF EXISTS "history_refresh_runs_id_organization_id_key";

ALTER TABLE "history_refresh_items"
  ADD CONSTRAINT "history_refresh_items_run_fkey"
  FOREIGN KEY ("history_refresh_run_id") REFERENCES "history_refresh_runs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
