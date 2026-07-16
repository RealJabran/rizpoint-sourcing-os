import fc from "fast-check";
import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  buildScenarios,
  calculateProfit,
  decide,
  type CostInputs,
  type FeeQuote,
  type PriceEvidence,
} from "../src/index.js";

const calculatedAt = new Date("2026-07-13T00:00:00Z");
const costs: CostInputs = {
  supplierCostPerSellableUnit: "4.0000",
  allocatedSupplierFreight: "0.5000",
  prepFee: "1.4900",
  labelingFee: "0.1000",
  polybagFee: "0.0500",
  bundleFee: "0.0500",
  bubblewrapFee: "0.0500",
  inboundShipping: "0.7500",
  dutyOrTax: "0.0000",
  storageAllowance: "0.2000",
  returnAllowance: "0.3000",
  otherCosts: "0.0000",
};

function price(price: string): PriceEvidence {
  return {
    price,
    currency: "USD",
    provider: "mock-amazon",
    observedAt: "2026-07-12T00:00:00Z",
    freshUntil: "2026-07-14T00:00:00Z",
    freshnessState: "FRESH",
  };
}

function feeQuote(quotedPrice = "20.00"): FeeQuote {
  return {
    totalFee: "5.0000",
    quotedPrice,
    currency: "USD",
    provider: "mock-amazon",
    observedAt: "2026-07-12T00:00:00Z",
    freshUntil: "2026-07-14T00:00:00Z",
    freshnessState: "FRESH",
    completeness: "COMPLETE",
    scenarioSource: "CURRENT_FEATURED_OFFER",
    fulfillmentChannel: "AMAZON",
    components: [
      { feeType: "FulfillmentFee", finalFee: "2.0000", currency: "USD" },
      { feeType: "ReferralFee", finalFee: "3.0000", currency: "USD" },
    ],
    model: { fixedFee: "2.0000", percentageOfPrice: "0.1500" },
  };
}

function profitAt(value: string) {
  return calculateProfit({
    packGuardStatus: "VERIFIED",
    price: price(value),
    feeQuote: feeQuote(),
    costs,
    calculatedAt,
  });
}

describe("profit engine v3", () => {
  it("matches an independently audited dynamic-fee example", () => {
    const result = profitAt("20.00");
    expect(result).toMatchObject({
      status: "CALCULATED",
      effectiveCogs: "7.49",
      amazonFees: "5.00",
      netProfit: "7.51",
      roiPercent: "100.27",
      marginPercent: "37.55",
      breakEvenPrice: "11.17",
      exactValues: {
        effectiveCogs: "7.4900",
        amazonFees: "5.0000",
        netProfit: "7.5100",
      },
    });
  });

  it("rounds break-even up so the displayed price cannot lose money", () => {
    const result = calculateProfit({
      packGuardStatus: "VERIFIED",
      price: price("20.00"),
      feeQuote: feeQuote(),
      costs: { ...costs, supplierCostPerSellableUnit: "10.0040" },
      calculatedAt,
    });
    expect(result.breakEvenPrice).toBe("18.23");
    const atDisplayedBreakEven = calculateProfit({
      packGuardStatus: "VERIFIED",
      price: price(result.breakEvenPrice!),
      feeQuote: feeQuote(),
      costs: { ...costs, supplierCostPerSellableUnit: "10.0040" },
      calculatedAt,
    });
    expect(atDisplayedBreakEven.exactValues?.netProfit).not.toMatch(/^-./);
  });

  it("blocks uncertain packs, zero supplier costs, stale evidence, bad quotes, and currency mismatches", () => {
    expect(
      calculateProfit({
        packGuardStatus: "BLOCKED_PACK_CONTRADICTION",
        price: price("20.00"),
        feeQuote: feeQuote(),
        costs,
        calculatedAt,
      }).status,
    ).toBe("BLOCKED_PACK_UNCERTAIN");
    expect(
      calculateProfit({
        packGuardStatus: "VERIFIED",
        price: price("20.00"),
        feeQuote: feeQuote(),
        costs: { ...costs, supplierCostPerSellableUnit: "0" },
        calculatedAt,
      }).status,
    ).toBe("BLOCKED_INVALID_INPUT");
    expect(
      calculateProfit({
        packGuardStatus: "VERIFIED",
        price: price("20.00"),
        feeQuote: { ...feeQuote(), freshUntil: "2026-07-12T00:00:00Z" },
        costs,
        calculatedAt,
      }).status,
    ).toBe("BLOCKED_STALE_EVIDENCE");
    expect(
      calculateProfit({
        packGuardStatus: "VERIFIED",
        price: price("20.00"),
        feeQuote: { ...feeQuote(), totalFee: "4.99" },
        costs,
        calculatedAt,
      }).status,
    ).toBe("BLOCKED_INVALID_INPUT");
    expect(
      calculateProfit({
        packGuardStatus: "VERIFIED",
        price: { ...price("20.00"), currency: "CAD" },
        feeQuote: feeQuote(),
        costs,
        calculatedAt,
      }).status,
    ).toBe("BLOCKED_CURRENCY_MISMATCH");
  });

  it("builds current, conservative, stress, and optional MAP scenarios without reusing a fixed fee", () => {
    const scenarios = buildScenarios({
      packGuardStatus: "VERIFIED",
      feeQuote: feeQuote(),
      costs,
      current: price("20.00"),
      conservative: price("19.00"),
      stressDiscountPercent: "10.00",
      map: price("21.00"),
      calculatedAt,
    });
    expect(scenarios.CONSERVATIVE?.amazonFees).toBe("4.85");
    expect(scenarios.STRESS?.amazonFees).toBe("4.57");
    expect(scenarios.MAP?.amazonFees).toBe("5.15");
    expect(
      buildScenarios({
        packGuardStatus: "VERIFIED",
        feeQuote: feeQuote(),
        costs,
        current: price("20.00"),
        conservative: price("19.00"),
        stressDiscountPercent: "-10.00",
        calculatedAt,
      }).STRESS?.reasonCodes,
    ).toContain("INVALID_STRESS_DISCOUNT");
  });

  it("never allows policy precedence or invalid thresholds to emit BUY", () => {
    const currentProfit = profitAt("20.00");
    const conservativeProfit = profitAt("19.00");
    const stressProfit = profitAt("17.10");
    const base = {
      currentProfit,
      conservativeProfit,
      stressProfit,
      matchVerified: true,
      sellerEligibility: "ELIGIBLE" as const,
      brandPolicy: "UNRESTRICTED" as const,
      demandEvidenceSufficient: true,
    };
    expect(
      decide({
        ...base,
        sellerEligibility: "UNKNOWN",
        brandPolicy: "PROHIBITED",
      }).recommendation,
    ).toBe("AVOID");
    expect(
      decide({
        ...base,
        thresholds: {
          minNetProfit: "-20.00",
          minRoiPercent: "-200.00",
          minMarginPercent: "-2000.00",
          maxStressLoss: "-20.00",
        },
      }).recommendation,
    ).toBe("INSUFFICIENT_DATA");
    expect(
      decide({
        ...base,
        currentProfit: { ...currentProfit, status: "BLOCKED_INVALID_INPUT" },
      }).recommendation,
    ).toBe("INSUFFICIENT_DATA");
  });

  it("uses complete component fees only at their quoted price when no model exists", () => {
    const { model: _model, ...baseQuote } = feeQuote();
    void _model;
    const pointQuote: FeeQuote = {
      ...baseQuote,
      components: [
        { feeType: "ReferralFee", finalFee: "3.0000", currency: "USD" },
        { feeType: "FBAFees", finalFee: "2.0000", currency: "USD" },
      ],
    };
    const exact = calculateProfit({
      packGuardStatus: "VERIFIED",
      price: price("20.00"),
      feeQuote: pointQuote,
      costs,
      calculatedAt,
    });
    expect(exact).toMatchObject({
      status: "CALCULATED",
      proceeds: "20.00",
      amazonFees: "5.00",
      netProfit: "7.51",
    });
    expect(exact.breakEvenPrice).toBeUndefined();
    expect(
      calculateProfit({
        packGuardStatus: "VERIFIED",
        price: price("19.00"),
        feeQuote: pointQuote,
        costs,
        calculatedAt,
      }).status,
    ).toBe("BLOCKED_INVALID_INPUT");
    expect(
      calculateProfit({
        packGuardStatus: "VERIFIED",
        price: price("20.00"),
        feeQuote: { ...pointQuote, completeness: "PARTIAL" },
        costs,
        calculatedAt,
      }).status,
    ).toBe("BLOCKED_INVALID_INPUT");
  });

  it("blocks component currency/total defects and guards zero prices", () => {
    expect(
      calculateProfit({
        packGuardStatus: "VERIFIED",
        price: price("20.00"),
        feeQuote: {
          ...feeQuote(),
          components: [
            { feeType: "AmazonFees", finalFee: "5.0000", currency: "CAD" },
          ],
        },
        costs,
        calculatedAt,
      }).status,
    ).toBe("BLOCKED_CURRENCY_MISMATCH");
    expect(
      calculateProfit({
        packGuardStatus: "VERIFIED",
        price: price("0"),
        feeQuote: feeQuote("0"),
        costs,
        calculatedAt,
      }).status,
    ).toBe("BLOCKED_INVALID_INPUT");
  });

  it("keeps negative profit deterministic without converting it to missing data", () => {
    const result = calculateProfit({
      packGuardStatus: "VERIFIED",
      price: price("10.00"),
      feeQuote: feeQuote(),
      costs: { ...costs, supplierCostPerSellableUnit: "20.0000" },
      calculatedAt,
    });
    expect(result.status).toBe("CALCULATED");
    expect(new Decimal(result.netProfit!).lt(0)).toBe(true);
  });

  it("supports an explicitly quoted user-entered scenario without inventing fees", () => {
    const { model: _model, ...baseQuote } = feeQuote("24.00");
    void _model;
    const userFee = {
      ...baseQuote,
      totalFee: "5.6000",
      scenarioSource: "USER_ENTERED" as const,
      components: [
        { feeType: "AmazonFees", finalFee: "5.6000", currency: "USD" },
      ],
    };
    const scenarios = buildScenarios({
      packGuardStatus: "VERIFIED",
      feeQuote: feeQuote(),
      feeQuotes: { USER_ENTERED: userFee },
      costs,
      current: price("20.00"),
      conservative: price("19.00"),
      userEntered: price("24.00"),
      stressDiscountPercent: "10",
      calculatedAt,
    });
    expect(scenarios.USER_ENTERED).toMatchObject({
      status: "CALCULATED",
      proceeds: "24.00",
      amazonFees: "5.60",
    });
  });

  it.each([
    ["RESTRICTED", "AVOID"],
    ["APPROVAL_REQUIRED", "REVIEW_APPROVAL"],
    ["INCOMPLETE", "INSUFFICIENT_DATA"],
    ["UNAUTHORIZED", "INSUFFICIENT_DATA"],
    ["THROTTLED", "INSUFFICIENT_DATA"],
    ["UNKNOWN", "INSUFFICIENT_DATA"],
  ] as const)(
    "maps %s seller eligibility to %s",
    (sellerEligibility, expected) => {
      const profit = profitAt("20.00");
      expect(
        decide({
          currentProfit: profit,
          conservativeProfit: profit,
          stressProfit: profit,
          matchVerified: true,
          sellerEligibility,
          brandPolicy: "UNRESTRICTED",
          demandEvidenceSufficient: true,
        }).recommendation,
      ).toBe(expected);
    },
  );

  it("preserves Decimal monotonicity and break-even invariants", () => {
    const centsToDecimal = (cents: number) => {
      const digits = String(cents).padStart(3, "0");
      return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
    };
    fc.assert(
      fc.property(fc.integer({ min: 1200, max: 5000 }), (cents) => {
        const low = profitAt(centsToDecimal(cents));
        const high = profitAt(centsToDecimal(cents + 100));
        expect(low.status).toBe("CALCULATED");
        expect(high.status).toBe("CALCULATED");
        expect(
          new Decimal(high.exactValues!.netProfit).gt(
            new Decimal(low.exactValues!.netProfit),
          ),
        ).toBe(true);
        const breakEven = profitAt(low.breakEvenPrice!);
        expect(new Decimal(breakEven.exactValues!.netProfit).gte(0)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
