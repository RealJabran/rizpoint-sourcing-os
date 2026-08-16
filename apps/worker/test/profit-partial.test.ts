import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProfitCalculationForProcessing: vi.fn(),
  isProfitVerifiedMatch: vi.fn(() => false),
  markProfitCalculationRunning: vi.fn(),
  persistProfitCalculation: vi.fn(),
  ensureExactFeeQuote: vi.fn(),
  findExactFeeQuote: vi.fn(),
}));

vi.mock("@rizpoint/database", () => mocks);
vi.mock("../src/fee-scenarios.js", () => ({
  ensureExactFeeQuote: mocks.ensureExactFeeQuote,
  findExactFeeQuote: mocks.findExactFeeQuote,
}));

const decimal = (value: string) => ({ toString: () => value });

describe("profit calculation with partial rows", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T00:00:00.000Z"));
    vi.clearAllMocks();
    mocks.findExactFeeQuote.mockReturnValue(null);
    mocks.isProfitVerifiedMatch.mockReturnValue(false);
  });

  afterEach(() => vi.useRealTimers());

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

  it("acquires exact conservative, stress, and user-entered fees before calculating", async () => {
    const quote = (
      quotedPrice: string,
      scenarioSource:
        "CURRENT_FEATURED_OFFER" | "CONSERVATIVE" | "USER_ENTERED",
    ) => ({
      totalFee: "5.0000",
      quotedPrice,
      currency: "USD",
      provider: "amazon-sp-api",
      observedAt: "2026-07-16T00:00:00.000Z",
      freshUntil: "2026-07-20T00:00:00.000Z",
      freshnessState: "FRESH" as const,
      completeness: "COMPLETE" as const,
      scenarioSource,
      fulfillmentChannel: "AMAZON" as const,
      model: undefined,
      components: [
        {
          feeType: "AmazonFees",
          finalFee: "5.0000",
          currency: "USD",
        },
      ],
    });
    mocks.findExactFeeQuote.mockImplementation(
      (_observations, scenarioSource, price) =>
        scenarioSource === "CURRENT_FEATURED_OFFER"
          ? quote(price, scenarioSource)
          : null,
    );
    mocks.ensureExactFeeQuote.mockImplementation(({ price, scenarioSource }) =>
      Promise.resolve(quote(price, scenarioSource)),
    );
    mocks.isProfitVerifiedMatch.mockReturnValue(true);
    mocks.markProfitCalculationRunning.mockResolvedValue(true);
    mocks.getProfitCalculationForProcessing.mockResolvedValue({
      id: "run-scenarios",
      organizationId: "org-1",
      attemptCount: 1,
      scope: "TARGETED",
      targets: [{ supplierRowId: "row-1", shippingRouteId: "route-1" }],
      routes: [
        {
          id: "route-1",
          name: "FBA",
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
      organization: {
        brandPolicies: [{ brand: "Acme", status: "APPROVED", expiresAt: null }],
      },
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
            id: "row-1",
            matchDecision: {
              status: "AUTO_ACCEPTED",
              reasonCodes: [],
              selectedCandidate: {
                catalogProduct: { asin: "B000000001", brand: "Acme" },
                packGuard: {
                  status: "VERIFIED",
                  costPerSellableUnit: decimal("4"),
                },
              },
            },
            profitCostOverrides: [
              {
                id: "override-1",
                shippingRouteId: "route-1",
                revision: 1,
                reason: "Scenario test",
                stressDiscountPercent: decimal("10"),
                userEnteredSalePrice: decimal("25"),
                updatedAt: new Date("2026-07-16T00:00:00.000Z"),
                values: [],
              },
            ],
            enrichmentItems: [
              {
                id: "item-1",
                asin: "B000000001",
                enrichmentRun: {
                  id: "enrichment-1",
                  attemptCount: 1,
                  providerConnection: null,
                },
                observations: [
                  {
                    metricType: "PRICING",
                    provider: "AMAZON_SP_API",
                    observedAt: new Date("2026-07-16T00:00:00.000Z"),
                    freshUntil: new Date("2026-07-20T00:00:00.000Z"),
                    freshnessState: "FRESH",
                    currency: "USD",
                    primaryAmount: decimal("20"),
                    featuredFulfillment: "AMAZON",
                  },
                  {
                    metricType: "HISTORY",
                    provider: "MOCK_HISTORY",
                    observedAt: new Date("2026-07-16T00:00:00.000Z"),
                    freshUntil: new Date("2026-07-20T00:00:00.000Z"),
                    freshnessState: "FRESH",
                    currency: "USD",
                    payload: { value: [{ price: "18.0000" }] },
                  },
                  {
                    metricType: "RESTRICTIONS",
                    provider: "AMAZON_SP_API",
                    observedAt: new Date("2026-07-16T00:00:00.000Z"),
                    freshUntil: new Date("2026-07-20T00:00:00.000Z"),
                    freshnessState: "FRESH",
                    observationStatus: "SUCCESS",
                    completeness: "COMPLETE",
                    restrictionState: "ELIGIBLE",
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    const { processProfitCalculation } = await import("../src/profit.js");
    await processProfitCalculation("run-scenarios");

    expect(
      mocks.findExactFeeQuote.mock.calls.map(([, source, price]) => ({
        source,
        price,
      })),
    ).toEqual([
      { source: "CURRENT_FEATURED_OFFER", price: "20" },
      { source: "CONSERVATIVE", price: "18.0000" },
      { source: "CONSERVATIVE", price: "16.2000" },
      { source: "USER_ENTERED", price: "25" },
    ]);
    expect(
      mocks.ensureExactFeeQuote.mock.calls.map(([call]) => ({
        scenarioSource: call.scenarioSource,
        price: call.price,
      })),
    ).toEqual([
      { scenarioSource: "CONSERVATIVE", price: "18.0000" },
      { scenarioSource: "CONSERVATIVE", price: "16.2000" },
      { scenarioSource: "USER_ENTERED", price: "25" },
    ]);
    expect(mocks.ensureExactFeeQuote).toHaveBeenCalledWith(
      expect.objectContaining({
        scenarioSource: "CONSERVATIVE",
        price: "18.0000",
      }),
    );
    expect(mocks.ensureExactFeeQuote).toHaveBeenCalledWith(
      expect.objectContaining({
        scenarioSource: "CONSERVATIVE",
        price: "16.2000",
      }),
    );
    expect(mocks.ensureExactFeeQuote).toHaveBeenCalledWith(
      expect.objectContaining({
        scenarioSource: "USER_ENTERED",
        price: "25",
      }),
    );
    expect(mocks.persistProfitCalculation).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "COMPLETED",
        results: [expect.objectContaining({ status: "COMPLETED" })],
      }),
    );
  });
});
