import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  optimizePortfolio,
  type PortfolioCandidateInput,
  type PortfolioConstraints,
} from "../src/index.js";

function candidate(
  id: string,
  overrides: Partial<PortfolioCandidateInput> = {},
): PortfolioCandidateInput {
  return {
    id,
    catalogProductId: `product-${id}`,
    asin: `B0000000${id}`,
    brand: `Brand ${id}`,
    category: `Category ${id}`,
    currency: "USD",
    unitCost: "10",
    sellingPrice: "25",
    feePerUnit: "5",
    adCostPerUnit: "2",
    moq: 20,
    casePack: 10,
    expectedMonthlyDemandLow: "60",
    expectedMonthlyDemandHigh: "100",
    netProfitPerUnitLow: "4",
    netProfitPerUnitHigh: "7",
    leadTimeDays: 30,
    marginPercent: "20",
    roiPercent: "40",
    confidencePercent: "80",
    seasonalityRisk: "LOW",
    complianceRisk: "LOW",
    priceVolatilityPercent: "8",
    competitionRisk: "LOW",
    targetInventoryDays: 30,
    observedAt: "2026-08-17T00:00:00.000Z",
    evidenceReferences: [`evidence-${id}`],
    ...overrides,
  };
}

function constraints(
  overrides: Partial<PortfolioConstraints> = {},
): PortfolioConstraints {
  return {
    cashBudget: "1000",
    currency: "USD",
    maxAsinExposurePercent: "60",
    maxBrandExposurePercent: "70",
    maxCategoryExposurePercent: "70",
    minMarginPercent: "5",
    minRoiPercent: "5",
    minConfidencePercent: "50",
    maxPriceVolatilityPercent: "30",
    allowedComplianceRisks: ["LOW", "REVIEW"],
    maxSeasonalityRisk: "MEDIUM",
    maxCompetitionRisk: "MEDIUM",
    ...overrides,
  };
}

describe("portfolio optimizer v1", () => {
  it("returns the same exact portfolio for identical candidates in any order", () => {
    const candidates = [
      candidate("A"),
      candidate("B", {
        unitCost: "20",
        netProfitPerUnitLow: "7",
        netProfitPerUnitHigh: "10",
        moq: 10,
        casePack: 10,
      }),
      candidate("C", {
        unitCost: "25",
        netProfitPerUnitLow: "5",
        netProfitPerUnitHigh: "8",
      }),
    ];
    const first = optimizePortfolio({ candidates, constraints: constraints() });
    const second = optimizePortfolio({
      candidates: [...candidates].reverse(),
      constraints: constraints(),
    });
    expect(first.status).toBe("CALCULATED");
    expect(first.scenarios[0]?.recommended?.allocations).toEqual(
      second.scenarios[0]?.recommended?.allocations,
    );
    expect(first.scenarios[0]?.exactOptimal).toBe(true);
    expect(
      first.scenarios[0]?.recommended?.constraintAudit.every(
        (row) => row.passed,
      ),
    ).toBe(true);
  });

  it("excludes disallowed compliance risk and audits MOQ/case quantities", () => {
    const output = optimizePortfolio({
      candidates: [
        candidate("A"),
        candidate("B", { complianceRisk: "UNKNOWN" }),
      ],
      constraints: constraints(),
    });
    const base = output.scenarios[0]!;
    expect(base.recommended?.excludedProducts).toContainEqual({
      candidateId: "B",
      asin: "B0000000B",
      reasons: ["COMPLIANCE_RISK_UNKNOWN_NOT_ALLOWED"],
    });
    expect(
      base.recommended?.allocations.every(
        (allocation) =>
          allocation.quantity >= allocation.moq &&
          allocation.quantity % allocation.casePack === 0,
      ),
    ).toBe(true);
  });

  it("calculates all named stress modes with explicit assumptions", () => {
    const output = optimizePortfolio({
      candidates: [candidate("A")],
      constraints: constraints(),
    });
    expect(output.scenarios.map((scenario) => scenario.scenario)).toEqual([
      "BASE",
      "DEMAND_DOWN_20",
      "PRICE_DOWN_10",
      "FEE_UP_5",
      "DELAYED_REPLENISHMENT",
      "AD_COST_INCREASE",
    ]);
    expect(output.scenarios[1]?.assumptions).toMatchObject({
      demandDecreasePercent: "20",
    });
    expect(output.scenarios[4]?.assumptions).toMatchObject({
      replenishmentDelayDays: "30",
    });
  });

  it("fails closed instead of presenting a partial solution when the option space is unsafe", () => {
    const output = optimizePortfolio({
      candidates: [
        candidate("A", {
          unitCost: "1",
          moq: 1,
          casePack: 1,
          expectedMonthlyDemandHigh: "10000",
        }),
      ],
      constraints: constraints({ maxAsinExposurePercent: "100" }),
    });
    expect(output.status).toBe("SOLVER_FAILED");
    expect(output.scenarios[0]).toMatchObject({
      status: "SOLVER_FAILED",
      exactOptimal: false,
    });
    expect(output.scenarios[0]?.recommended).toBeUndefined();
    expect(output.scenarios[0]?.reasonCodes[0]).toMatch(
      /CANDIDATE_OPTION_SPACE_EXCEEDED/,
    );
  });

  it("returns an explicit invalid-input state for missing evidence", () => {
    const output = optimizePortfolio({
      candidates: [candidate("A", { evidenceReferences: [] })],
      constraints: constraints(),
    });
    expect(output).toMatchObject({ status: "INVALID_INPUT", scenarios: [] });
    expect(output.reasonCodes[0]).toMatch(/INVALID_CANDIDATE_HEADER/);
  });

  it("preserves determinism and hard constraints across generated fixtures", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            unitCost: fc.integer({ min: 2, max: 30 }),
            profitLow: fc.integer({ min: 1, max: 12 }),
            demand: fc.integer({ min: 20, max: 40 }),
          }),
          { minLength: 1, maxLength: 3 },
        ),
        fc.integer({ min: 500, max: 5_000 }),
        (rows, budget) => {
          const generated = rows.map((row, index) =>
            candidate(String(index), {
              unitCost: String(row.unitCost),
              netProfitPerUnitLow: String(row.profitLow),
              netProfitPerUnitHigh: String(row.profitLow + 3),
              expectedMonthlyDemandLow: String(row.demand),
              expectedMonthlyDemandHigh: String(row.demand + 30),
              moq: 10,
              casePack: 10,
            }),
          );
          const policy = constraints({
            cashBudget: String(budget),
            maxAsinExposurePercent: "100",
            maxBrandExposurePercent: "100",
            maxCategoryExposurePercent: "100",
          });
          const first = optimizePortfolio({
            candidates: generated,
            constraints: policy,
          });
          const second = optimizePortfolio({
            candidates: generated,
            constraints: policy,
          });
          expect(first).toEqual(second);
          for (const scenario of first.scenarios)
            if (scenario.recommended)
              expect(
                scenario.recommended.constraintAudit.every(
                  (audit) => audit.passed,
                ),
              ).toBe(true);
        },
      ),
      { numRuns: 40 },
    );
  });
});
