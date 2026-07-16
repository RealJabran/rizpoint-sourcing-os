import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderError } from "@rizpoint/provider-contracts";

const mocks = vi.hoisted(() => ({
  persistEnrichmentItem: vi.fn(),
  recordProviderCallAttempt: vi.fn(),
  createEnrichmentProvider: vi.fn(),
}));

vi.mock("@rizpoint/database", () => ({
  persistEnrichmentItem: mocks.persistEnrichmentItem,
  recordProviderCallAttempt: mocks.recordProviderCallAttempt,
}));
vi.mock("../src/enrichment-provider.js", () => ({
  createEnrichmentProvider: mocks.createEnrichmentProvider,
}));

const calculatedAt = new Date("2026-07-18T12:00:00.000Z");
const item = {
  id: "item-1",
  asin: "B000000001",
  enrichmentRun: {
    id: "enrichment-1",
    attemptCount: 1,
    providerConnection: null,
  },
};

function estimate(price: string, scenarioSource = "CONSERVATIVE" as const) {
  return {
    value: {
      operation: "getMyFeesEstimateForASIN" as const,
      asin: item.asin,
      marketplaceId: "ATVPDKIKX0DER",
      totalFee: "4.5500",
      quotedPrice: price,
      listingPrice: price,
      shippingPrice: "0",
      currency: "USD",
      fulfillmentChannel: "AMAZON" as const,
      scenarioSource,
      completeness: "COMPLETE" as const,
      components: [
        {
          feeType: "AmazonFees",
          feeAmount: "4.5500",
          finalFee: "4.5500",
          currency: "USD",
        },
      ],
    },
    provenance: {
      provider: "amazon-sp-api",
      observedAt: "2026-07-18T12:00:00.000Z",
      freshnessState: "FRESH" as const,
      providerReference: "request-1",
      marketplaceId: "ATVPDKIKX0DER",
      responseCompleteness: "COMPLETE" as const,
    },
    rawProviderObservation: { response: "private" },
  };
}

describe("exact-price fee scenario acquisition", () => {
  beforeEach(() => vi.clearAllMocks());

  it("single-flights a scenario request and persists typed evidence without changing enrichment status", async () => {
    const estimateFees = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return estimate("17.0000");
    });
    mocks.createEnrichmentProvider.mockReturnValue({
      provider: { estimateFees },
      providerKind: "AMAZON_SP_API",
      marketplace: {
        marketplaceId: "ATVPDKIKX0DER",
        region: "NA",
        sellerId: "seller-1",
      },
    });
    const { ensureExactFeeQuote } = await import("../src/fee-scenarios.js");
    const request = {
      organizationId: "org-1",
      calculationAttempt: 1,
      item,
      observations: [],
      scenarioSource: "CONSERVATIVE" as const,
      price: "17.0000",
      currency: "USD",
      fulfillmentChannel: "AMAZON" as const,
      calculatedAt,
    };

    const [first, duplicate] = await Promise.all([
      ensureExactFeeQuote(request),
      ensureExactFeeQuote(request),
    ]);

    expect(estimateFees).toHaveBeenCalledOnce();
    expect(first).toEqual(duplicate);
    expect(first).toMatchObject({
      quotedPrice: "17.0000",
      scenarioSource: "CONSERVATIVE",
      totalFee: "4.5500",
    });
    expect(mocks.persistEnrichmentItem).toHaveBeenCalledOnce();
    expect(mocks.persistEnrichmentItem).toHaveBeenCalledWith(
      expect.objectContaining({
        enrichmentItemId: item.id,
        preserveItemStatus: true,
        observations: [
          expect.objectContaining({
            observationKey: expect.stringMatching(/^FEE:CONSERVATIVE:/),
            quotedPrice: "17.0000",
            feeScenarioSource: "CONSERVATIVE",
            feeComponents: [expect.objectContaining({ finalFee: "4.5500" })],
          }),
        ],
      }),
    );
    expect(mocks.recordProviderCallAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ status: "SUCCESS" }),
    );
  });

  it("reuses a fresh exact quote without another provider call", async () => {
    const observation = {
      metricType: "FEES",
      provider: "AMAZON_SP_API",
      observedAt: calculatedAt,
      freshUntil: new Date("2026-07-18T12:15:00.000Z"),
      freshnessState: "FRESH" as const,
      currency: "USD",
      primaryAmount: { toString: () => "4.5500" },
      quotedPrice: { toString: () => "17.0000" },
      completeness: "COMPLETE" as const,
      observationStatus: "SUCCESS",
      feeScenarioSource: "CONSERVATIVE" as const,
      feeFulfillment: "AMAZON" as const,
      feeComponents: [
        {
          feeType: "AmazonFees",
          parentFeeType: null,
          currency: "USD",
          finalFee: { toString: () => "4.5500" },
        },
      ],
      payload: estimate("17.0000"),
    };
    const { ensureExactFeeQuote } = await import("../src/fee-scenarios.js");
    await expect(
      ensureExactFeeQuote({
        organizationId: "org-1",
        calculationAttempt: 2,
        item,
        observations: [observation],
        scenarioSource: "CONSERVATIVE",
        price: "17.0000",
        currency: "USD",
        fulfillmentChannel: "AMAZON",
        calculatedAt,
      }),
    ).resolves.toMatchObject({ quotedPrice: "17.0000" });
    expect(mocks.createEnrichmentProvider).not.toHaveBeenCalled();
  });

  it("records and rethrows throttling so the calculation job can retry", async () => {
    mocks.createEnrichmentProvider.mockReturnValue({
      provider: {
        estimateFees: vi
          .fn()
          .mockRejectedValue(
            new ProviderError("THROTTLED", { retryAfterMs: 2_000 }),
          ),
      },
      providerKind: "AMAZON_SP_API",
      marketplace: {
        marketplaceId: "ATVPDKIKX0DER",
        region: "NA",
        sellerId: "seller-1",
      },
    });
    const { ensureExactFeeQuote } = await import("../src/fee-scenarios.js");
    await expect(
      ensureExactFeeQuote({
        organizationId: "org-1",
        calculationAttempt: 1,
        item,
        observations: [],
        scenarioSource: "USER_ENTERED",
        price: "25.0000",
        currency: "USD",
        fulfillmentChannel: "AMAZON",
        calculatedAt,
      }),
    ).rejects.toMatchObject({ code: "THROTTLED" });
    expect(mocks.recordProviderCallAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ status: "THROTTLED", errorCode: "THROTTLED" }),
    );
    expect(mocks.persistEnrichmentItem).toHaveBeenCalledWith(
      expect.objectContaining({
        preserveItemStatus: true,
        observations: [
          expect.objectContaining({
            observationStatus: "THROTTLED",
            completeness: "UNKNOWN",
          }),
        ],
      }),
    );
  });

  it("rejects and records a provider quote whose currency does not match the request", async () => {
    const mismatched = estimate("17.0000");
    mismatched.value.currency = "EUR";
    mocks.createEnrichmentProvider.mockReturnValue({
      provider: { estimateFees: vi.fn().mockResolvedValue(mismatched) },
      providerKind: "AMAZON_SP_API",
      marketplace: {
        marketplaceId: "ATVPDKIKX0DER",
        region: "NA",
        sellerId: "seller-1",
      },
    });
    const { ensureExactFeeQuote } = await import("../src/fee-scenarios.js");
    await expect(
      ensureExactFeeQuote({
        organizationId: "org-1",
        calculationAttempt: 1,
        item,
        observations: [],
        scenarioSource: "CONSERVATIVE",
        price: "17.0000",
        currency: "USD",
        fulfillmentChannel: "AMAZON",
        calculatedAt,
      }),
    ).resolves.toBeNull();
    expect(mocks.recordProviderCallAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "PERMANENT_ERROR",
        errorCode: "INVALID_RESPONSE",
      }),
    );
    expect(mocks.persistEnrichmentItem).toHaveBeenCalledWith(
      expect.objectContaining({
        observations: [
          expect.objectContaining({
            observationStatus: "TERMINAL_FAILURE",
            completeness: "UNKNOWN",
          }),
        ],
      }),
    );
  });
});
