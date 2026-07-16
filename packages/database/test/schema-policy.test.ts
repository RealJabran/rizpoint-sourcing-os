import { describe, expect, it } from "vitest";
import {
  PHASE_ZERO_ORGANIZATION_SLUG,
  isProfitVerifiedMatch,
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
