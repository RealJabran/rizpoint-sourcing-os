import { describe, expect, it } from "vitest";
import { poSummaryTable, poTable } from "../src/export.js";

const order = {
  id: "po_123",
  currency: "USD",
  scenarioType: "CONSERVATIVE",
  supplier: { name: "VSI" },
  shippingRoute: { name: "Prep route" },
  supplierSubtotal: { toString: () => "24.0000" },
  landedCostTotal: { toString: () => "96.0000" },
  projectedRevenueTotal: { toString: () => "240.0000" },
  amazonFeeTotal: { toString: () => "36.0000" },
  projectedProfitTotal: { toString: () => "108.0000" },
  lines: [
    {
      requestedUnits: 6,
      casePack: 6,
      minimumOrderCases: 1,
      orderMultipleCases: 1,
      orderedCases: 1,
      orderedSellableUnits: 6,
      supplierUnitCost: { toString: () => "2.0000" },
      supplierTotal: { toString: () => "12.0000" },
      landedCostTotal: { toString: () => "48.0000" },
      scenarioPrice: { toString: () => "20.0000" },
      amazonFeeTotal: { toString: () => "18.0000" },
      projectedProfitTotal: { toString: () => "54.0000" },
      warnings: ["CARTON_ROUNDING_APPLIED"],
      sourceSnapshot: {
        engineVersion: "profit-engine/v1",
        inputSnapshot: { costs: { prepFee: "1.0000" } },
        orderingRules: {
          source: "supplier-sheet",
          observedAt: "2026-07-14T00:00:00.000Z",
        },
        evidence: {
          packGuard: { status: "VERIFIED" },
          current: { provider: "wrong-provider" },
          scenarios: {
            CONSERVATIVE: {
              evidence: {
                price: {
                  provider: "history-provider",
                  observedAt: "2026-07-14T00:00:00.000Z",
                  freshUntil: "2026-07-15T00:00:00.000Z",
                },
                feeQuote: {
                  provider: "fee-provider",
                  observedAt: "2026-07-14T00:00:00.000Z",
                  freshUntil: "2026-07-15T00:00:00.000Z",
                },
              },
            },
          },
        },
      },
      supplierRow: {
        normalizedOffer: {
          itemNumber: "00123",
          asin: null,
          description: "Widget",
        },
        matchDecision: {
          selectedCandidate: {
            catalogProduct: { asin: "B000000001", title: "Widget" },
          },
        },
      },
    },
  ],
};

describe("purchase-order export tables", () => {
  it("includes canonical summary totals and selected-scenario audit provenance", () => {
    const summary = poSummaryTable(order as never);
    const audit = poTable(order as never, true);
    const normal = poTable(order as never);
    expect(summary.rows[0]).toContain("108.0000");
    expect(normal.columns).toContain("PO supplier subtotal");
    expect(normal.rows[0]).toContain("po_123");
    expect(audit.rows[0]).toContain("history-provider");
    expect(audit.rows[0]).toContain("fee-provider");
    expect(audit.rows[0]).not.toContain("wrong-provider");
  });
});
