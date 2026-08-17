import { describe, expect, it } from "vitest";
import {
  calculatePrivateLabelScenario,
  PRIVATE_LABEL_COST_CATEGORIES,
  stressPrivateLabelScenario,
  type PrivateLabelCostCategory,
  type PrivateLabelCostInput,
  type PrivateLabelScenarioInput,
} from "../src/index.js";

const values: Record<
  PrivateLabelCostCategory,
  Pick<PrivateLabelCostInput, "allocation" | "amount">
> = {
  SAMPLES: { allocation: "BATCH_TOTAL", amount: "100" },
  TOOLING_SETUP: { allocation: "BATCH_TOTAL", amount: "900" },
  PACKAGING: { allocation: "PER_UNIT", amount: "0.50" },
  LABELING: { allocation: "PER_UNIT", amount: "0.10" },
  INSPECTION: { allocation: "BATCH_TOTAL", amount: "200" },
  FREIGHT: { allocation: "BATCH_TOTAL", amount: "1000" },
  CUSTOMS_TARIFFS: { allocation: "BATCH_TOTAL", amount: "500" },
  INSURANCE: { allocation: "BATCH_TOTAL", amount: "100" },
  PREP: { allocation: "PER_UNIT", amount: "0.30" },
  INBOUND_SHIPPING: { allocation: "PER_UNIT", amount: "0.40" },
  AMAZON_REFERRAL: { allocation: "PERCENT_OF_PRICE", amount: "15" },
  AMAZON_FBA: { allocation: "PER_UNIT", amount: "3" },
  STORAGE_ALLOWANCE: { allocation: "PER_UNIT", amount: "0.20" },
  RETURNS_ALLOWANCE: { allocation: "PERCENT_OF_PRICE", amount: "5" },
  AD_LAUNCH_BUDGET: { allocation: "BATCH_TOTAL", amount: "1000" },
  COUPON_PROMO: { allocation: "PERCENT_OF_PRICE", amount: "2" },
  DEFECT_ALLOWANCE: { allocation: "PER_UNIT", amount: "0.10" },
};

function scenario(): PrivateLabelScenarioInput {
  return {
    incoterm: "FOB",
    supplierCurrency: "USD",
    analysisCurrency: "USD",
    unitCost: "5.00",
    moq: 1000,
    targetSellingPrice: "20.00",
    unitCostSource: "audited supplier quote Q-1",
    unitCostAssumedAt: "2026-08-17T00:00:00Z",
    costs: PRIVATE_LABEL_COST_CATEGORIES.map((category) => ({
      category,
      ...values[category],
      currency: "USD",
      source: `audited ${category}`,
      assumedAt: "2026-08-17T00:00:00Z",
      confidence: "CONFIRMED",
    })),
  };
}

describe("private-label profitability v1", () => {
  it("reconciles an independently audited MOQ scenario to the cent", () => {
    expect(calculatePrivateLabelScenario(scenario())).toMatchObject({
      status: "CALCULATED",
      landedCostPerUnit: "8.1000",
      contributionMarginPerUnit: "3.2000",
      netProfitPerUnit: "2.2000",
      roiPercent: "24.1758",
      marginPercent: "11.0000",
      breakEvenSalePrice: "17.1795",
      breakEvenAdSpendPerUnit: "3.2000",
      breakEvenAcosPercent: "16.0000",
      initialCashRequired: "10100.0000",
      moqCashExposure: "8100.0000",
    });
  });

  it("blocks omitted/unknown costs and undocumented currency conversion", () => {
    expect(
      calculatePrivateLabelScenario({
        ...scenario(),
        costs: scenario().costs.slice(1),
      }).status,
    ).toBe("BLOCKED_MISSING_COST");
    expect(
      calculatePrivateLabelScenario({
        ...scenario(),
        supplierCurrency: "CNY",
      }).reasonCodes,
    ).toContain("FX_OBSERVATION_REQUIRED");
  });

  it("uses an explicit Decimal FX observation for supplier-currency costs", () => {
    const result = calculatePrivateLabelScenario({
      ...scenario(),
      supplierCurrency: "CNY",
      fxObservation: {
        fromCurrency: "CNY",
        toCurrency: "USD",
        rate: "0.14",
        source: "recorded central-bank reference",
        observedAt: "2026-08-17T00:00:00Z",
      },
    });
    expect(result).toMatchObject({
      status: "CALCULATED",
      landedCostPerUnit: "3.8000",
      moqCashExposure: "3800.0000",
    });
  });

  it("builds named price/cost sensitivity without mutating the baseline", () => {
    const baseline = scenario();
    const stressed = stressPrivateLabelScenario(baseline, {
      name: "price -10 / costs +10",
      priceChangePercent: "-10",
      costChangePercent: "10",
    });
    expect(stressed.result.status).toBe("CALCULATED");
    expect(Number(stressed.result.netProfitPerUnit)).toBeLessThan(2.2);
    expect(baseline.targetSellingPrice).toBe("20.00");
  });
});
