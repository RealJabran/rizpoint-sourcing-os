import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderError } from "@rizpoint/provider-contracts";
const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  complete: vi.fn(),
  connection: vi.fn(),
  access: vi.fn(),
  createBundle: vi.fn(),
  getItem: vi.fn(),
  searchByKeywords: vi.fn(),
  pricing: vi.fn(),
  fees: vi.fn(),
  restrictions: vi.fn(),
}));

vi.mock("@rizpoint/database", () => ({
  claimProductResearchRun: mocks.claim,
  completeProductResearchRun: mocks.complete,
  getCatalogProviderConnection: mocks.connection,
}));
vi.mock("../src/provider-data-access.js", () => ({
  accessProviderData: mocks.access,
}));
vi.mock("../src/enrichment-provider.js", () => ({
  createEnrichmentProvider: mocks.createBundle,
}));

const observedAt = "2026-08-22T10:00:00.000Z";
const provenance = {
  provider: "amazon-sp-api",
  dataOrigin: "LIVE_AMAZON" as const,
  observedAt,
  freshnessState: "FRESH" as const,
  providerReference: "B000000001",
  marketplaceId: "ATVPDKIKX0DER",
  responseCompleteness: "COMPLETE" as const,
};
const product = {
  asin: "B000000001",
  title: "Verified catalog product",
  brand: "Evidence Brand",
  identifiers: [{ type: "ASIN" as const, value: "B000000001" }],
  images: [{ url: "https://images.example.test/product.jpg" }],
  salesRanks: [{ classificationId: "home", rank: 42 }],
  provenance,
};

function bundle(mode: "LIVE" | "MOCK" = "LIVE") {
  return {
    providerKey: mode === "LIVE" ? "amazon-sp-api" : "mock-amazon",
    providerKind: mode === "LIVE" ? "AMAZON_SP_API" : "MOCK_AMAZON",
    mode,
    marketplace: {
      marketplaceId: "ATVPDKIKX0DER",
      region: "NA",
      sellerId: "seller",
    },
    capabilities: ["CATALOG", "COMPETITIVE_OFFERS", "FEES", "RESTRICTIONS"],
    provider: {
      getItem: mocks.getItem,
      searchByIdentifier: vi.fn(),
      searchByKeywords: mocks.searchByKeywords,
      getCompetitivePricing: mocks.pricing,
      estimateFees: mocks.fees,
      getRestrictions: mocks.restrictions,
    },
  };
}

describe("product research worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connection.mockResolvedValue({ id: "connection" });
    mocks.createBundle.mockReturnValue(bundle());
    mocks.getItem.mockResolvedValue(product);
    mocks.searchByKeywords.mockResolvedValue([product]);
    mocks.pricing.mockResolvedValue({
      value: {
        operation: "getCompetitiveSummary",
        asin: product.asin,
        marketplaceId: "ATVPDKIKX0DER",
        featuredOfferState: "PRESENT",
        featuredOffer: {
          sellerId: "seller",
          condition: "New",
          subCondition: "New",
          fulfillmentChannel: "AMAZON",
          listingPrice: "24.99",
          shippingPrice: "0",
          landedPrice: "24.99",
          currency: "USD",
          memberships: [],
          isFeatured: true,
        },
        completeness: "COMPLETE",
        totalVisibleOffers: { value: 3, completeness: "COMPLETE" },
        fbaVisibleOffers: { value: 2, completeness: "COMPLETE" },
        fbmVisibleOffers: { value: 1, completeness: "COMPLETE" },
        visibleOfferCount: 3,
        fbaOfferCount: 2,
        fbmOfferCount: 1,
        amazonRetailPresence: "ABSENT",
        brandSellerStatus: "UNKNOWN",
        offers: [],
      },
      provenance,
    });
    mocks.fees.mockResolvedValue({
      value: {
        operation: "getMyFeesEstimateForASIN",
        asin: product.asin,
        marketplaceId: "ATVPDKIKX0DER",
        totalFee: "7.25",
        quotedPrice: "24.99",
        listingPrice: "24.99",
        shippingPrice: "0",
        currency: "USD",
        fulfillmentChannel: "AMAZON",
        scenarioSource: "CURRENT_FEATURED_OFFER",
        completeness: "COMPLETE",
        components: [],
      },
      provenance,
    });
    mocks.restrictions.mockResolvedValue({
      value: {
        operation: "getListingsRestrictions",
        asin: product.asin,
        marketplaceId: "ATVPDKIKX0DER",
        state: "ELIGIBLE",
        completeness: "COMPLETE",
        reasons: [],
      },
      provenance,
    });
    mocks.access.mockImplementation(async (input) => {
      const fetched = await input.fetch();
      return {
        projection: fetched.projection,
        source: "PROVIDER",
        cacheOutcome: "MISS",
        providerCalled: true,
        observedAt: fetched.observedAt,
        freshUntil: new Date("2026-08-23T10:00:00.000Z"),
        staleUntil: new Date("2026-08-24T10:00:00.000Z"),
        completeness: fetched.completeness,
        refreshScheduled: false,
      };
    });
  });

  it("persists catalog, pricing, fee, and restriction evidence for manual research", async () => {
    mocks.claim.mockResolvedValue({
      id: "run",
      organizationId: "org",
      kind: "PRODUCT_LOOKUP",
      status: "RUNNING",
      marketplaceId: "ATVPDKIKX0DER",
      providerKey: "amazon-sp-api",
      providerMode: "LIVE",
      queryType: "ASIN",
      queryText: product.asin,
      normalizedQuery: product.asin,
      requestedLimit: 1,
      salePrice: null,
      currency: null,
      forceRefresh: false,
    });
    const { processProductResearchRun } =
      await import("../src/product-research.js");
    await processProductResearchRun("run");
    expect(mocks.getItem).toHaveBeenCalledTimes(1);
    expect(mocks.pricing).toHaveBeenCalledTimes(1);
    expect(mocks.fees).toHaveBeenCalledTimes(1);
    expect(mocks.restrictions).toHaveBeenCalledTimes(1);
    expect(mocks.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org",
        items: [
          expect.objectContaining({
            dataOrigin: "LIVE_AMAZON",
            completeness: "COMPLETE",
            evidence: expect.objectContaining({
              pricing: expect.objectContaining({ status: "AVAILABLE" }),
              fees: expect.objectContaining({ status: "AVAILABLE" }),
              restrictions: expect.objectContaining({ status: "AVAILABLE" }),
              history: expect.objectContaining({ status: "PROVIDER_REQUIRED" }),
            }),
          }),
        ],
      }),
    );
  });

  it("persists a bounded catalog universe without pretending it is demand", async () => {
    mocks.claim.mockResolvedValue({
      id: "run",
      organizationId: "org",
      kind: "CATALOG_SEARCH",
      status: "RUNNING",
      marketplaceId: "ATVPDKIKX0DER",
      providerKey: "amazon-sp-api",
      providerMode: "LIVE",
      queryType: "KEYWORD",
      queryText: "dog grooming brush",
      normalizedQuery: "dog grooming brush",
      requestedLimit: 20,
      salePrice: null,
      currency: null,
      forceRefresh: false,
    });
    const { processProductResearchRun } =
      await import("../src/product-research.js");
    await processProductResearchRun("run");
    expect(mocks.searchByKeywords).toHaveBeenCalledTimes(1);
    expect(mocks.pricing).not.toHaveBeenCalled();
    expect(mocks.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            evidence: expect.objectContaining({
              researchedUniverse: expect.objectContaining({
                kind: "AMAZON_CATALOG_KEYWORD_RESULTS",
                statement: expect.stringContaining(
                  "not the entire Amazon database",
                ),
              }),
            }),
          }),
        ],
      }),
    );
  });

  it("refuses to let mock runtime masquerade as a queued live run", async () => {
    mocks.claim.mockResolvedValue({
      id: "run",
      organizationId: "org",
      kind: "PRODUCT_LOOKUP",
      status: "RUNNING",
      marketplaceId: "ATVPDKIKX0DER",
      providerKey: "amazon-sp-api",
      providerMode: "LIVE",
      queryType: "ASIN",
      queryText: product.asin,
      normalizedQuery: product.asin,
      requestedLimit: 1,
      forceRefresh: false,
    });
    mocks.createBundle.mockReturnValue(bundle("MOCK"));
    const { processProductResearchRun } =
      await import("../src/product-research.js");
    await expect(processProductResearchRun("run")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("keeps Amazon throttles retryable instead of persisting a false empty value", async () => {
    mocks.claim.mockResolvedValue({
      id: "run",
      organizationId: "org",
      kind: "PRODUCT_LOOKUP",
      status: "RUNNING",
      marketplaceId: "ATVPDKIKX0DER",
      providerKey: "amazon-sp-api",
      providerMode: "LIVE",
      queryType: "ASIN",
      queryText: product.asin,
      normalizedQuery: product.asin,
      requestedLimit: 1,
      forceRefresh: false,
    });
    mocks.pricing.mockRejectedValue(
      new ProviderError("THROTTLED", { retryAfterMs: 30_000 }),
    );
    const { processProductResearchRun } =
      await import("../src/product-research.js");
    await expect(processProductResearchRun("run")).rejects.toMatchObject({
      code: "THROTTLED",
      options: { retryAfterMs: 30_000 },
    });
    expect(mocks.complete).not.toHaveBeenCalled();
  });
});
