-- Structural rollback for an approved image rollback only. Do not restore or
-- extend Amazon Information that the forward migration already expired.

ALTER TABLE "provider_cache_entries"
  DROP CONSTRAINT IF EXISTS "provider_cache_entries_amazon_retention_ceiling_check";

DROP TABLE IF EXISTS "amazon_deletion_tombstones";
DROP TABLE IF EXISTS "amazon_retention_runs";
DROP TABLE IF EXISTS "amazon_deletion_requests";

DROP TYPE IF EXISTS "AmazonRetentionRunStatus";
DROP TYPE IF EXISTS "AmazonDeletionRequestStatus";
DROP TYPE IF EXISTS "AmazonDeletionRequestReason";
