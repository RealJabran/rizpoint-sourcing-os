import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderError } from "@rizpoint/provider-contracts";

const mocks = vi.hoisted(() => ({
  completeEnrichmentRun: vi.fn(),
  getEnrichmentRunForProcessing: vi.fn(),
  persistEnrichmentItem: vi.fn(),
  recordProviderCallAttempt: vi.fn(),
  scheduleEnrichmentRetry: vi.fn(),
  createEnrichmentProvider: vi.fn(),
  providerCallsInc: vi.fn(),
}));

vi.mock("@rizpoint/database", () => ({
  completeEnrichmentRun: mocks.completeEnrichmentRun,
  getEnrichmentRunForProcessing: mocks.getEnrichmentRunForProcessing,
  persistEnrichmentItem: mocks.persistEnrichmentItem,
  recordProviderCallAttempt: mocks.recordProviderCallAttempt,
  scheduleEnrichmentRetry: mocks.scheduleEnrichmentRetry,
}));
vi.mock("../src/enrichment-provider.js", () => ({
  createEnrichmentProvider: mocks.createEnrichmentProvider,
}));
vi.mock("../src/observability.js", () => ({
  providerCalls: { inc: mocks.providerCallsInc },
}));

const observedAt = "2026-07-18T12:00:00.000Z";
const provenance = {
  provider: "mock-amazon",
  observedAt,
  freshnessState: "FRESH" as const,
  providerReference: "B000000001",
};

function feeResult(price = "18.99") {
  return {
    value: {
      operation: "getMyFeesEstimateForASIN",
      asin: "B000000001",
      marketplaceId: "ATVPDKIKX0DER",
      totalFee: "3.10",
      quotedPrice: price,
      listingPrice: price,
      shippingPrice: "0",
      currency: "USD",
      fulfillmentChannel: "AMAZON" as const,
      scenarioSource: "CURRENT_FEATURED_OFFER" as const,
      completeness: "COMPLETE" as const,
      components: [
        {
          feeType: "AmazonFees",
          feeAmount: "3.10",
          finalFee: "3.10",
          currency: "USD",
        },
      ],
      model: { fixedFee: "0.2515", percentageOfPrice: "0.15" },
    },
    provenance,
    rawProviderObservation: { fee: "private" },
  };
}

function restrictionResult(
  state: "ELIGIBLE" | "APPROVAL_REQUIRED" | "RESTRICTED" = "ELIGIBLE",
) {
  return {
    value: {
      operation: "getListingsRestrictions",
      asin: "B000000001",
      marketplaceId: "ATVPDKIKX0DER",
      state,
      completeness: "COMPLETE" as const,
      conditionType: "new_new",
      reasons: [],
    },
    provenance,
  };
}

describe("competitive-pricing enrichment", () => {
  beforeEach(() => vi.clearAllMocks());

  it("batches duplicate ASIN rows once and persists typed pricing on each checkpoint", async () => {
    const getCompetitivePricingBatch = vi.fn().mockResolvedValue([
      {
        asin: "B000000001",
        status: "SUCCESS",
        pricing: {
          value: {
            operation: "getCompetitiveSummary",
            asin: "B000000001",
            marketplaceId: "ATVPDKIKX0DER",
            currency: "USD",
            lowestPrice: "17.99",
            featuredOfferState: "PRESENT",
            featuredOffer: {
              sellerId: "third-party-fba",
              fulfillmentChannel: "AMAZON",
              landedPrice: "18.99",
              currency: "USD",
              memberships: [],
              isFeatured: true,
            },
            completeness: "PARTIAL",
            totalVisibleOffers: { value: 2, completeness: "PARTIAL" },
            fbaVisibleOffers: { value: 1, completeness: "PARTIAL" },
            fbmVisibleOffers: { value: 1, completeness: "PARTIAL" },
            amazonRetailPresence: "UNKNOWN",
            brandSellerStatus: "UNKNOWN",
            lowestFbaPrice: "17.99",
            lowestFbmPrice: "18.49",
            offers: [],
          },
          provenance,
          rawProviderObservation: { response: "private-evidence" },
        },
      },
    ]);
    const provider = {
      getCompetitivePricingBatch,
      getCompetitivePricing: vi.fn(),
      getItem: vi.fn().mockResolvedValue({ value: {}, provenance }),
      estimateFees: vi.fn().mockResolvedValue(feeResult()),
      getRestrictions: vi.fn().mockResolvedValue(restrictionResult()),
      getHistory: vi.fn().mockResolvedValue({
        value: [{ observedAt, price: "17.99", currency: "USD" }],
        provenance,
      }),
    };
    mocks.createEnrichmentProvider.mockReturnValue({
      provider,
      providerKind: "MOCK_AMAZON",
      marketplace: { marketplaceId: "ATVPDKIKX0DER", region: "NA" },
    });
    mocks.getEnrichmentRunForProcessing.mockResolvedValue({
      id: "run-1",
      organizationId: "org-1",
      attemptCount: 1,
      providerConnection: null,
      items: [
        {
          id: "item-1",
          asin: "B000000001",
          status: "PENDING",
          observations: [
            {
              metricType: "PRICING",
              observationStatus: "SUCCESS",
              freshUntil: new Date("2020-01-01T00:00:00.000Z"),
            },
          ],
        },
        {
          id: "item-2",
          asin: "B000000001",
          status: "PENDING",
          observations: [
            {
              metricType: "PRICING",
              observationStatus: "SUCCESS",
              freshUntil: new Date("2020-01-01T00:00:00.000Z"),
            },
          ],
        },
      ],
    });
    mocks.scheduleEnrichmentRetry.mockResolvedValue(false);
    const { processEnrichment } = await import("../src/enrichment.js");

    await processEnrichment("scan-1");

    expect(getCompetitivePricingBatch).toHaveBeenCalledOnce();
    expect(getCompetitivePricingBatch).toHaveBeenCalledWith(
      ["B000000001"],
      expect.objectContaining({ marketplaceId: "ATVPDKIKX0DER" }),
    );
    expect(provider.getCompetitivePricing).not.toHaveBeenCalled();
    expect(mocks.persistEnrichmentItem).toHaveBeenCalledTimes(2);
    for (const call of mocks.persistEnrichmentItem.mock.calls) {
      expect(call[0].missingMetrics).toContain("PRICING_PARTIAL_RESPONSE");
      const pricing = call[0].observations.find(
        (observation: { metricType: string }) =>
          observation.metricType === "PRICING",
      );
      expect(pricing).toMatchObject({
        operation: "getCompetitiveSummary",
        observationStatus: "PARTIAL",
        featuredOfferState: "PRESENT",
        featuredPrice: "18.99",
        featuredFulfillment: "AMAZON",
        amazonRetailPresence: "UNKNOWN",
        visibleOfferCount: 2,
        visibleOfferCountCompleteness: "PARTIAL",
        fbaOfferCount: 1,
        fbmOfferCount: 1,
        lowestFbaPrice: "17.99",
        lowestFbmPrice: "18.49",
      });
      expect(pricing.requestHash).toMatch(/^[a-f0-9]{64}$/);
      expect(pricing.rawEvidenceReference).toMatch(/^[a-f0-9]{64}$/);
      expect(pricing.rawEvidence).toEqual({ response: "private-evidence" });
      const fees = call[0].observations.find(
        (observation: { metricType: string }) =>
          observation.metricType === "FEES",
      );
      expect(fees).toMatchObject({
        operation: "getMyFeesEstimateForASIN",
        observationStatus: "SUCCESS",
        completeness: "COMPLETE",
        quotedPrice: "18.99",
        feeScenarioSource: "CURRENT_FEATURED_OFFER",
        feeFulfillment: "AMAZON",
        feeComponents: [
          {
            feeType: "AmazonFees",
            feeAmount: "3.10",
            finalFee: "3.10",
            currency: "USD",
          },
        ],
      });
      const restriction = call[0].observations.find(
        (observation: { metricType: string }) =>
          observation.metricType === "RESTRICTIONS",
      );
      expect(restriction).toMatchObject({
        operation: "getListingsRestrictions",
        observationStatus: "SUCCESS",
        restrictionState: "ELIGIBLE",
        completeness: "COMPLETE",
      });
    }
    expect(provider.estimateFees).toHaveBeenCalledOnce();
    expect(provider.estimateFees).toHaveBeenCalledWith(
      expect.objectContaining({
        price: "18.99",
        currency: "USD",
        fulfillmentChannel: "AMAZON",
        scenarioSource: "CURRENT_FEATURED_OFFER",
      }),
    );
    expect(provider.getRestrictions).toHaveBeenCalledOnce();
  });

  it("does not call pricing again for a successful persisted observation", async () => {
    const getCompetitivePricingBatch = vi.fn();
    mocks.createEnrichmentProvider.mockReturnValue({
      provider: {
        getCompetitivePricingBatch,
        getCompetitivePricing: vi.fn(),
        getItem: vi.fn().mockResolvedValue({ value: {}, provenance }),
        estimateFees: vi.fn().mockResolvedValue(feeResult("17.99")),
        getRestrictions: vi.fn().mockResolvedValue(restrictionResult()),
        getHistory: vi.fn().mockResolvedValue({ value: [], provenance }),
      },
      providerKind: "MOCK_AMAZON",
      marketplace: { marketplaceId: "ATVPDKIKX0DER", region: "NA" },
    });
    mocks.getEnrichmentRunForProcessing.mockResolvedValue({
      id: "run-2",
      organizationId: "org-1",
      attemptCount: 2,
      providerConnection: null,
      items: [
        {
          id: "item-1",
          asin: "B000000001",
          status: "PARTIAL_SUCCESS",
          observations: [
            {
              metricType: "PRICING",
              observationStatus: "SUCCESS",
              freshUntil: new Date("2099-01-01T00:00:00.000Z"),
              observedAt: new Date(observedAt),
              freshnessState: "FRESH",
              provider: "MOCK_AMAZON",
              providerReference: "B000000001",
              primaryAmount: { toString: () => "17.99" },
              currency: "USD",
              payload: {
                value: { lowestPrice: "17.99", currency: "USD" },
              },
            },
          ],
        },
      ],
    });
    mocks.scheduleEnrichmentRetry.mockResolvedValue(false);
    const { processEnrichment } = await import("../src/enrichment.js");

    await processEnrichment("scan-2");

    expect(getCompetitivePricingBatch).not.toHaveBeenCalled();
    expect(
      mocks.createEnrichmentProvider.mock.results[0]?.value.provider
        .getCompetitivePricing,
    ).not.toHaveBeenCalled();
    expect(
      mocks.recordProviderCallAttempt.mock.calls.filter(
        ([input]) => input.operation === "getCompetitiveSummary",
      ),
    ).toHaveLength(0);
  });

  it.each([
    ["UNAUTHORIZED", "UNAUTHORIZED", false],
    ["THROTTLED", "THROTTLED", true],
  ] as const)(
    "persists %s pricing as explicit unknown data",
    async (errorCode, observationStatus, schedulesRetry) => {
      const error = new ProviderError(
        errorCode,
        errorCode === "THROTTLED" ? { retryAfterMs: 2_000 } : {},
      );
      const getCompetitivePricingBatch = schedulesRetry
        ? vi.fn().mockResolvedValue([
            {
              asin: "B000000001",
              status: "ERROR",
              error: { code: "THROTTLED", retryAfterMs: 2_000 },
            },
          ])
        : vi.fn().mockRejectedValue(error);
      const provider = {
        getCompetitivePricingBatch,
        getCompetitivePricing: vi.fn(),
        getItem: vi.fn().mockResolvedValue({ value: {}, provenance }),
        estimateFees: vi.fn(),
        getRestrictions: vi.fn().mockResolvedValue(restrictionResult()),
        getHistory: vi.fn().mockResolvedValue({ value: [], provenance }),
      };
      mocks.createEnrichmentProvider.mockReturnValue({
        provider,
        providerKind: "AMAZON_SP_API",
        marketplace: { marketplaceId: "ATVPDKIKX0DER", region: "NA" },
      });
      mocks.getEnrichmentRunForProcessing.mockResolvedValue({
        id: "run-errors",
        organizationId: "org-1",
        attemptCount: 3,
        providerConnection: null,
        items: [
          {
            id: "item-errors",
            asin: "B000000001",
            status: "PENDING",
            observations: [],
          },
        ],
      });
      mocks.scheduleEnrichmentRetry.mockResolvedValue(schedulesRetry);
      const { processEnrichment } = await import("../src/enrichment.js");

      await processEnrichment("scan-errors");

      const persisted = mocks.persistEnrichmentItem.mock.calls[0]?.[0];
      const pricing = persisted.observations.find(
        (observation: { metricType: string }) =>
          observation.metricType === "PRICING",
      );
      expect(pricing).toMatchObject({
        observationStatus,
        completeness: "UNKNOWN",
        featuredOfferState: "UNKNOWN",
        amazonRetailPresence: "UNKNOWN",
        visibleOfferCountCompleteness: "UNKNOWN",
        fbaOfferCountCompleteness: "UNKNOWN",
        fbmOfferCountCompleteness: "UNKNOWN",
      });
      expect(pricing).not.toHaveProperty("visibleOfferCount");
      expect(pricing).not.toHaveProperty("fbaOfferCount");
      expect(pricing).not.toHaveProperty("fbmOfferCount");
      expect(mocks.scheduleEnrichmentRetry).toHaveBeenCalledTimes(
        schedulesRetry ? 1 : 0,
      );
    },
  );
});
