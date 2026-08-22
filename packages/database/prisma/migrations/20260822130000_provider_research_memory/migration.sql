ALTER TABLE "history_refresh_runs"
ADD COLUMN "force_refresh" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "enrichment_runs"
ADD COLUMN "force_refresh" BOOLEAN NOT NULL DEFAULT false;
