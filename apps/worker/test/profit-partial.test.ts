import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProfitCalculationForProcessing: vi.fn(),
  isProfitVerifiedMatch: vi.fn(() => false),
  markProfitCalculationRunning: vi.fn(),
  persistProfitCalculation: vi.fn(),
}));

vi.mock("@rizpoint/database", () => mocks);

const decimal = (value: string) => ({ toString: () => value });

describe("profit calculation with partial rows", () => {
  beforeEach(() => vi.clearAllMocks());

  it("persists an unmatched row without dereferencing missing observations", async () => {
    mocks.markProfitCalculationRunning.mockResolvedValue(true);
    mocks.getProfitCalculationForProcessing.mockResolvedValue({
      id: "run-1",
      organizationId: "org-1",
      scope: "FULL",
      targets: [],
      routes: [
        {
          id: "route-1",
          name: "Demo route",
          currency: "USD",
          effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
          allocatedSupplierFreight: decimal("0"),
          prepFee: decimal("0"),
          labelingFee: decimal("0"),
          polybagFee: decimal("0"),
          bundleFee: decimal("0"),
          bubblewrapFee: decimal("0"),
          inboundShipping: decimal("0"),
          dutyOrTax: decimal("0"),
          storageAllowance: decimal("0"),
          returnAllowance: decimal("0"),
          otherCosts: decimal("0"),
        },
      ],
      organization: { brandPolicies: [] },
      financialPolicy: {
        id: "policy-1",
        currency: "USD",
        engineVersion: "profit-engine/v3",
        minimumDemandScore: 1,
        minNetProfit: decimal("3"),
        minRoiPercent: decimal("20"),
        minMarginPercent: decimal("10"),
        maxStressLoss: decimal("0"),
        stressDiscountPercent: decimal("10"),
      },
      scanJob: {
        supplierRows: [
          {
            id: "row-unmatched",
            enrichmentItems: [],
            matchDecision: null,
            profitCostOverrides: [],
          },
        ],
      },
    });

    const { processProfitCalculation } = await import("../src/profit.js");
    await expect(processProfitCalculation("run-1")).resolves.toBeUndefined();

    expect(mocks.persistProfitCalculation).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        organizationId: "org-1",
        status: "PARTIAL_SUCCESS",
        results: [
          expect.objectContaining({
            supplierRowId: "row-unmatched",
            status: "PARTIAL_SUCCESS",
            recommendation: "REVIEW_MATCH",
          }),
        ],
      }),
    );
  });
});
