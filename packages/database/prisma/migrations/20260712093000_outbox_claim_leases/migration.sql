ALTER TABLE "outbox_events"
  ADD COLUMN "claim_token" TEXT,
  ADD COLUMN "claimed_at" TIMESTAMP(3),
  ADD COLUMN "delivery_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "last_error" TEXT;

DROP INDEX "outbox_events_status_created_at_idx";
CREATE INDEX "outbox_events_status_claimed_at_created_at_idx"
  ON "outbox_events"("status", "claimed_at", "created_at");
