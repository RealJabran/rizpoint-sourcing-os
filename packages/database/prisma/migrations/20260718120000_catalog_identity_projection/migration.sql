-- Safe normalized catalog identity fields. raw_payload remains private and is
-- intentionally never selected by browser-facing repository functions.
ALTER TABLE "catalog_products"
  ADD COLUMN "marketplace_id" TEXT,
  ADD COLUMN "response_completeness" TEXT,
  ADD COLUMN "request_lineage" TEXT,
  ADD COLUMN "identity_projection" JSONB;
