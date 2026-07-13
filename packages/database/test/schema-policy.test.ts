import { describe, expect, it } from "vitest";
import {
  PHASE_ZERO_ORGANIZATION_SLUG,
  shouldPromoteProfitResult,
} from "../src/repositories.js";
import {
  AnalysisOverrideStatus,
  CostOverrideField,
  ProductRecommendation,
  ProfitCalculationStatus,
} from "../src/index.js";

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
});
