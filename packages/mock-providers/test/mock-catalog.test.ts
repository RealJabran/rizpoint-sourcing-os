import { describe, expect, it } from "vitest";
import { MockAmazonProvider, MockCatalogProvider } from "../src/index.js";

describe("mock catalog provider", () => {
  it("returns provenance-bearing exact identifier results", async () => {
    const results = await new MockCatalogProvider().searchByIdentifier({
      type: "UPC",
      value: "012345678905",
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.provenance).toMatchObject({
      provider: "mock-catalog",
      freshnessState: "FRESH",
    });
  });

  it("preserves the requested marketplace in catalog provenance", async () => {
    const provider = new MockCatalogProvider();
    const [product] = await provider.searchByIdentifier(
      { type: "ASIN", value: "B000000001" },
      { marketplaceId: "ATVPDKIKX0DER", region: "NA" },
    );
    expect(product?.provenance.marketplaceId).toBe("ATVPDKIKX0DER");
  });

  it("supports the MPN and title-search cascade boundaries", async () => {
    const provider = new MockCatalogProvider();
    expect(
      await provider.searchByIdentifier({ type: "MPN", value: "LEMON-12" }),
    ).toHaveLength(3);
    expect(await provider.searchByKeywords("Lemon Soda")).toHaveLength(3);
  });
});

it("returns provenance-bearing enrichment fixtures", async () => {
  const provider = new MockAmazonProvider();
  const marketplace = {
    marketplaceId: "ATVPDKIKX0DER",
    region: "NA" as const,
    sellerId: "mock",
  };
  const [pricing, fees, restrictions] = await Promise.all([
    provider.getCompetitivePricing("B000000001", marketplace),
    provider.estimateFees({
      asin: "B000000001",
      marketplace,
      fulfillmentChannel: "AMAZON",
      scenarioSource: "CURRENT_FEATURED_OFFER",
      price: "10.00",
      shippingPrice: "0",
      currency: "USD",
      requestId: "test",
    }),
    provider.getRestrictions("B000000001", marketplace),
  ]);
  expect(pricing.provenance.observedAt).toBeTruthy();
  expect(fees.value.totalFee).toBe("3.5000");
  expect(fees.value.quotedPrice).toBe("10.00");
  expect(fees.value.components).toHaveLength(2);
  expect(fees.value.completeness).toBe("COMPLETE");
  expect(restrictions.value.state).toBe("ELIGIBLE");
});

it("keeps deterministic offer presence and unknown states distinct", async () => {
  const provider = new MockAmazonProvider();
  const marketplace = {
    marketplaceId: "ATVPDKIKX0DER",
    region: "NA" as const,
  };
  const observations = await provider.getCompetitivePricingBatch(
    ["B000000001", "B000000002", "B000000003"],
    marketplace,
  );
  const pricing = observations.flatMap((item) =>
    item.status === "SUCCESS" ? [item.pricing] : [],
  );
  expect(pricing.map((item) => item.value.featuredOfferState)).toEqual([
    "PRESENT",
    "ABSENT",
    "UNKNOWN",
  ]);
  expect(pricing.map((item) => item.value.amazonRetailPresence)).toEqual([
    "PRESENT",
    "ABSENT",
    "UNKNOWN",
  ]);
  expect(pricing[0]?.value.fbaVisibleOffers).toEqual({
    value: 2,
    completeness: "COMPLETE",
  });
  expect(pricing[2]?.value.completeness).toBe("PARTIAL");
});
