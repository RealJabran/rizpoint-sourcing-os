-- Supporting indexes for SupplierRow lifecycle operations. PostgreSQL does not
-- create indexes for referencing foreign keys automatically; without these,
-- deleting or retry-cleaning a large scan can repeatedly scan child tables.
CREATE INDEX "enrichment_items_supplier_row_id_idx"
  ON "enrichment_items"("supplier_row_id");

CREATE INDEX "profit_results_supplier_row_id_idx"
  ON "profit_results"("supplier_row_id");

CREATE INDEX "profit_cost_overrides_supplier_row_id_idx"
  ON "profit_cost_overrides"("supplier_row_id");

CREATE INDEX "profit_calculation_targets_supplier_row_id_idx"
  ON "profit_calculation_targets"("supplier_row_id");

CREATE INDEX "purchase_order_lines_supplier_row_id_idx"
  ON "purchase_order_lines"("supplier_row_id");

-- Rollback:
-- DROP INDEX "purchase_order_lines_supplier_row_id_idx";
-- DROP INDEX "profit_calculation_targets_supplier_row_id_idx";
-- DROP INDEX "profit_cost_overrides_supplier_row_id_idx";
-- DROP INDEX "profit_results_supplier_row_id_idx";
-- DROP INDEX "enrichment_items_supplier_row_id_idx";
