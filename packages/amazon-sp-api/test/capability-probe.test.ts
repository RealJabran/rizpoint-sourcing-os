import { describe, expect, it, vi } from "vitest";
import type {
  CatalogProduct,
  CompetitivePricing,
  FeeEstimate,
  Restrictions,
} from "@rizpoint/provider-contracts";
import { ProviderError } from "@rizpoint/provider-contracts";
import { probeAmazonCapabilities } from "../src/index.js";

const marketplace = { marketplaceId: "ATVPDKIKX0DER", region: "NA" as const };
const provenance = {
  provider: "amazon-sp-api",
  dataOrigin: "LIVE_AMAZON" as const,
  observedAt: "2026-08-22T12:00:00.000Z",
  freshnessState: "FRESH" as const,
  marketplaceId: marketplace.marketplaceId,
  responseCompleteness: "COMPLETE" as const,
  requestId: "safe-request-id",
  rateLimitPerSecond: "2",
};
const product: CatalogProduct = {
  asin: "B000000001",
  title: "Fixture product",
  identifiers: [{ type: "UPC", value: "012345678905" }],
  provenance,
  rawProviderObservation: { confidential: "must-not-escape" },
};
const pricing: CompetitivePricing = {
  value: {
    operation: "getCompetitiveSummary",
    asin: product.asin,
    marketplaceId: marketplace.marketplaceId,
    featuredOfferState: "ABSENT",
    completeness: "COMPLETE",
    totalVisibleOffers: { value: 0, completeness: "COMPLETE" },
    fbaVisibleOffers: { value: 0, completeness: "COMPLETE" },
    fbmVisibleOffers: { value: 0, completeness: "COMPLETE" },
    amazonRetailPresence: "ABSENT",
    brandSellerStatus: "UNKNOWN",
    offers: [],
  },
  provenance,
};
const fees: FeeEstimate = {
  value: {
    operation: "getMyFeesEstimateForASIN",
    asin: product.asin,
    marketplaceId: marketplace.marketplaceId,
    totalFee: "5.00",
    quotedPrice: "20.00",
    listingPrice: "20.00",
    shippingPrice: "0",
    currency: "USD",
    fulfillmentChannel: "AMAZON",
    scenarioSource: "USER_ENTERED",
    completeness: "COMPLETE",
    components: [],
  },
  provenance,
};
const restrictions: Restrictions = {
  value: {
    operation: "getListingsRestrictions",
    asin: product.asin,
    marketplaceId: marketplace.marketplaceId,
    state: "ELIGIBLE",
    completeness: "COMPLETE",
    reasons: [],
  },
  provenance,
};

function provider(overrides: Record<string, unknown> = {}) {
  return {
    getItem: vi.fn(async () => product),
    searchByIdentifier: vi.fn(async () => [product]),
    searchByKeywords: vi.fn(async () => [product]),
    getCompetitivePricingBatch: vi.fn(async () => [
      { asin: product.asin, status: "SUCCESS" as const, pricing },
    ]),
    estimateFees: vi.fn(async () => fees),
    getRestrictions: vi.fn(async () => restrictions),
    ...overrides,
  };
}

describe("Amazon capability probe", () => {
  it("probes every supported API family and returns only sanitized evidence", async () => {
    const result = await probeAmazonCapabilities({
      provider: provider(),
      marketplace,
      feePrice: "20.00",
      currency: "USD",
      now: new Date("2026-08-22T12:00:00.000Z"),
    });
    expect(result.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ capability: "CATALOG", state: "HEALTHY" }),
        expect.objectContaining({
          capability: "COMPETITIVE_OFFERS",
          state: "HEALTHY",
        }),
        expect.objectContaining({ capability: "FEES", state: "HEALTHY" }),
        expect.objectContaining({
          capability: "RESTRICTIONS",
          state: "HEALTHY",
        }),
      ]),
    );
    expect(result.operations.map((item) => item.operation)).toEqual(
      expect.arrayContaining([
        "searchCatalogItems:keywords",
        "getCatalogItem",
        "searchCatalogItems:identifier",
        "getCompetitiveSummary",
        "getMyFeesEstimateForASIN",
        "getListingsRestrictions",
      ]),
    );
    expect(JSON.stringify(result)).not.toContain("must-not-escape");
    expect(result.dataOrigin).toBe("LIVE_AMAZON");
  });

  it("keeps denied roles distinct from a healthy connection", async () => {
    const denied = new ProviderError("FORBIDDEN", {
      httpStatus: 403,
      providerRequestId: "denied-request",
    });
    const result = await probeAmazonCapabilities({
      provider: provider({
        getCompetitivePricingBatch: vi.fn(async () => {
          throw denied;
        }),
        estimateFees: vi.fn(async () => {
          throw denied;
        }),
        getRestrictions: vi.fn(async () => {
          throw denied;
        }),
      }),
      marketplace,
      asins: [product.asin],
      feePrice: "20.00",
      currency: "USD",
    });
    expect(
      result.capabilities.filter((item) => item.capability !== "CATALOG"),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          state: "UNAUTHORIZED",
          reason: "CAPABILITY_NOT_ENTITLED",
        }),
      ]),
    );
  });

  it("persists a retry deadline without converting throttling into zero data", async () => {
    const result = await probeAmazonCapabilities({
      provider: provider({
        estimateFees: vi.fn(async () => {
          throw new ProviderError("THROTTLED", {
            httpStatus: 429,
            retryAfterMs: 45_000,
          });
        }),
      }),
      marketplace,
      asins: [product.asin],
      feePrice: "20.00",
      currency: "USD",
      now: new Date("2026-08-22T12:00:00.000Z"),
    });
    expect(result.capabilities).toContainEqual(
      expect.objectContaining({
        capability: "FEES",
        state: "THROTTLED",
        retryAt: "2026-08-22T12:00:45.000Z",
      }),
    );
  });

  it("keeps a no-result probe authorized but unproven", async () => {
    const result = await probeAmazonCapabilities({
      provider: provider({
        searchByKeywords: vi.fn(async () => []),
      }),
      marketplace,
      feePrice: "20.00",
      currency: "USD",
    });
    expect(result.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: "CATALOG",
          state: "AUTHORIZED",
          completeness: "UNKNOWN",
        }),
      ]),
    );
  });
});
