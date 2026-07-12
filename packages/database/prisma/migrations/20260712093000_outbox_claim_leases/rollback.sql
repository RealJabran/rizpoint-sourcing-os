DROP INDEX "outbox_events_status_claimed_at_created_at_idx";
CREATE INDEX "outbox_events_status_created_at_idx" ON "outbox_events"("status", "created_at");

ALTER TABLE "outbox_events"
  DROP COLUMN "last_error",
  DROP COLUMN "delivery_attempts",
  DROP COLUMN "claimed_at",
  DROP COLUMN "claim_token";
