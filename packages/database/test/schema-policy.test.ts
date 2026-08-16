import { describe, expect, it } from "vitest";
import {
  PHASE_ZERO_ORGANIZATION_SLUG,
  isProfitVerifiedMatch,
  providerCapabilityForOperation,
  providerRuntimeStateForAttempt,
  shouldReplaceProviderObservation,
  shouldPromoteProfitResult,
} from "../src/repositories.js";
import {
  AnalysisOverrideStatus,
  CostOverrideField,
  ProductRecommendation,
  ExportStatus,
  PurchaseOrderStatus,
  ShortlistItemStatus,
  ProfitCalculationStatus,
  FeeScenarioSource,
  ListingRestrictionState,
} from "../src/index.js";
import { readFile } from "node:fs/promises";

describe("database policy", () => {
  it("uses a named synthetic organization for Phase 0", () => {
    expect(PHASE_ZERO_ORGANIZATION_SLUG).toBe("rizpoint-demo");
  });

  it("exposes Phase 4 result states through the generated NUMERIC-backed schema", () => {
    expect(ProfitCalculationStatus.COMPLETED).toBe("COMPLETED");
    expect(ProductRecommendation.BUY).toBe("BUY");
  });

  it("exposes typed Phase 5 override states and money fields", () => {
    expect(AnalysisOverrideStatus.PENDING_RECALCULATION).toBe(
      "PENDING_RECALCULATION",
    );
    expect(CostOverrideField.SUPPLIER_COST_PER_SELLABLE_UNIT).toBe(
      "SUPPLIER_COST_PER_SELLABLE_UNIT",
    );
  });

  it("exposes Phase 6 workflow states", () => {
    expect(ShortlistItemStatus.READY_FOR_PO).toBe("READY_FOR_PO");
    expect(PurchaseOrderStatus.VALIDATED).toBe("VALIDATED");
    expect(ExportStatus.COMPLETED).toBe("COMPLETED");
  });

  it("does not promote a stale targeted override calculation", () => {
    expect(
      shouldPromoteProfitResult({
        appliedOverrideRevision: 2,
        currentOverride: { revision: 2, calculationRunId: "run-2" },
        runId: "run-2",
      }),
    ).toBe(true);
    expect(
      shouldPromoteProfitResult({
        appliedOverrideRevision: 1,
        currentOverride: { revision: 2, calculationRunId: "run-2" },
        runId: "run-1",
      }),
    ).toBe(false);
    expect(
      shouldPromoteProfitResult({
        currentOverride: { revision: 2, calculationRunId: "run-2" },
        runId: "full-run",
      }),
    ).toBe(false);
  });

  it("does not let a manually overridden hard contradiction become profit-verified", () => {
    expect(
      isProfitVerifiedMatch({
        status: "USER_ACCEPTED",
        reasonCodes: ["HARD_CONTRADICTION_MANUAL_OVERRIDE"],
      }),
    ).toBe(false);
    expect(
      isProfitVerifiedMatch({ status: "USER_ACCEPTED", reasonCodes: [] }),
    ).toBe(true);
  });

  it("scopes provider-attempt idempotency by organization and enrichment run", async () => {
    const schema = await readFile(
      new URL("../prisma/schema.prisma", import.meta.url),
      "utf8",
    );
    expect(schema).toContain(
      "@@unique([organizationId, enrichmentRunId, provider, operation, requestKey, attempt])",
    );
  });

  it("normalizes legacy SP-API attempts without turning failures into values", () => {
    expect(providerCapabilityForOperation("getCompetitiveSummary")).toBe(
      "COMPETITIVE_OFFERS",
    );
    expect(providerCapabilityForOperation("getMyFeesEstimateForASIN")).toBe(
      "FEES",
    );
    expect(providerRuntimeStateForAttempt("THROTTLED")).toBe("THROTTLED");
    expect(
      providerRuntimeStateForAttempt("PERMANENT_ERROR", "UNAUTHORIZED"),
    ).toBe("UNAUTHORIZED");
    expect(providerRuntimeStateForAttempt("RETRYABLE_ERROR")).toBe(
      "UNAVAILABLE",
    );
  });

  it("never lets an older pricing retry replace a newer observation", () => {
    const current = new Date("2026-07-18T12:00:00.000Z");
    expect(
      shouldReplaceProviderObservation(
        current,
        new Date("2026-07-18T11:59:59.999Z"),
      ),
    ).toBe(false);
    expect(shouldReplaceProviderObservation(current, current)).toBe(true);
    expect(
      shouldReplaceProviderObservation(
        current,
        new Date("2026-07-18T12:00:00.001Z"),
      ),
    ).toBe(true);
  });

  it("uses a scenario-aware typed provider observation idempotency key", async () => {
    const schema = await readFile(
      new URL("../prisma/schema.prisma", import.meta.url),
      "utf8",
    );
    expect(schema).toContain(
      "@@unique([enrichmentItemId, metricType, provider, observationKey])",
    );
    expect(schema).toContain(
      'observationKey                String                    @default("PRIMARY")',
    );
    for (const field of [
      "featuredOfferState",
      "amazonRetailPresence",
      "visibleOfferCountCompleteness",
      "fbaOfferCountCompleteness",
      "fbmOfferCountCompleteness",
      "rawEvidenceReference",
      "rawEvidence",
      "requestHash",
    ])
      expect(schema).toContain(field);
  });

  it("permits exactly one source and reserves scan sources for active-view exports", async () => {
    const migration = await readFile(
      new URL(
        "../prisma/migrations/20260718180000_analysis_view_export_source_constraint/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(migration).toContain('DROP CONSTRAINT "export_jobs_source"');
    expect(migration).toContain('"scan_job_id" IS NOT NULL)::int');
    expect(migration).toContain("= 1");
    expect(migration).toContain("'ANALYSIS_VIEW'");
  });

  it("indexes large supplier-row child relations used by cleanup and lifecycle cascades", async () => {
    const migration = await readFile(
      new URL(
        "../prisma/migrations/20260718190000_supplier_row_foreign_key_indexes/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    for (const index of [
      "enrichment_items_supplier_row_id_idx",
      "profit_results_supplier_row_id_idx",
      "profit_cost_overrides_supplier_row_id_idx",
      "profit_calculation_targets_supplier_row_id_idx",
      "purchase_order_lines_supplier_row_id_idx",
    ])
      expect(migration).toContain(index);
  });

  it("indexes remaining high-volume scan and export foreign-key lifecycle paths", async () => {
    const migration = await readFile(
      new URL(
        "../prisma/migrations/20260718200000_lifecycle_foreign_key_indexes/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    for (const index of [
      "profit_calculation_runs_scan_job_id_idx",
      "profit_results_scan_job_id_idx",
      "analysis_views_scan_job_id_idx",
      "profit_cost_overrides_scan_job_id_idx",
      "provider_call_attempts_enrichment_run_id_idx",
      "shortlist_notes_shortlist_item_id_idx",
      "export_jobs_scan_job_id_idx",
      "export_jobs_shortlist_id_idx",
      "export_jobs_purchase_order_id_idx",
    ])
      expect(migration).toContain(index);
  });

  it("stores account fee components as NUMERIC and restriction outcomes as explicit states", async () => {
    const schema = await readFile(
      new URL("../prisma/schema.prisma", import.meta.url),
      "utf8",
    );
    expect(FeeScenarioSource.CURRENT_FEATURED_OFFER).toBe(
      "CURRENT_FEATURED_OFFER",
    );
    expect(ListingRestrictionState.ELIGIBLE).toBe("ELIGIBLE");
    expect(ListingRestrictionState.UNAUTHORIZED).toBe("UNAUTHORIZED");
    expect(schema).toContain("model ProviderFeeComponent");
    expect(schema).toMatch(/feeAmount\s+Decimal[^\n]+@db\.Decimal\(18, 4\)/);
    expect(schema).toMatch(/finalFee\s+Decimal[^\n]+@db\.Decimal\(18, 4\)/);
    expect(schema).toContain("restrictionReasonCodes");
  });
});
