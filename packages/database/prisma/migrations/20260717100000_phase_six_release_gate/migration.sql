ALTER TABLE "suppliers"
  ADD COLUMN "minimum_order_cases" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "order_multiple_cases" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "minimum_order_amount" DECIMAL(18,4),
  ADD COLUMN "ordering_rules_source" TEXT,
  ADD COLUMN "ordering_rules_observed_at" TIMESTAMP(3),
  ADD CONSTRAINT "suppliers_ordering_rules_positive"
    CHECK ("minimum_order_cases" > 0 AND "order_multiple_cases" > 0 AND
      ("minimum_order_amount" IS NULL OR "minimum_order_amount" >= 0));
