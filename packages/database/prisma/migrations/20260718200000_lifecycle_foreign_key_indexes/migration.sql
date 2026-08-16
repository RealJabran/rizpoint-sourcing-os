-- Leading foreign-key indexes for high-volume lifecycle paths. PostgreSQL does
-- not add these automatically. They bound scan retry/cleanup cascades and
-- private-export source checks without changing any relationship semantics.
CREATE INDEX "profit_calculation_runs_scan_job_id_idx"
  ON "profit_calculation_runs"("scan_job_id");

CREATE INDEX "profit_results_scan_job_id_idx"
  ON "profit_results"("scan_job_id");

CREATE INDEX "analysis_views_scan_job_id_idx"
  ON "analysis_views"("scan_job_id");

CREATE INDEX "profit_cost_overrides_scan_job_id_idx"
  ON "profit_cost_overrides"("scan_job_id");

CREATE INDEX "provider_call_attempts_enrichment_run_id_idx"
  ON "provider_call_attempts"("enrichment_run_id");

CREATE INDEX "shortlist_notes_shortlist_item_id_idx"
  ON "shortlist_notes"("shortlist_item_id");

CREATE INDEX "export_jobs_scan_job_id_idx"
  ON "export_jobs"("scan_job_id");

CREATE INDEX "export_jobs_shortlist_id_idx"
  ON "export_jobs"("shortlist_id");

CREATE INDEX "export_jobs_purchase_order_id_idx"
  ON "export_jobs"("purchase_order_id");
