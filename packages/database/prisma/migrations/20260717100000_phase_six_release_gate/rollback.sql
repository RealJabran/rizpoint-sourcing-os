ALTER TABLE "suppliers"
  DROP CONSTRAINT IF EXISTS "suppliers_ordering_rules_positive",
  DROP COLUMN IF EXISTS "ordering_rules_observed_at",
  DROP COLUMN IF EXISTS "ordering_rules_source",
  DROP COLUMN IF EXISTS "minimum_order_amount",
  DROP COLUMN IF EXISTS "order_multiple_cases",
  DROP COLUMN IF EXISTS "minimum_order_cases";
