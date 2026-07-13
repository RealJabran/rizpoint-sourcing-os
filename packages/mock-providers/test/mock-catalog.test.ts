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
      price: "10.00",
      currency: "USD",
      requestId: "test",
    }),
    provider.getRestrictions("B000000001", marketplace),
  ]);
  expect(pricing.provenance.observedAt).toBeTruthy();
  expect(fees.value.totalFee).toBe("6.25");
  expect(restrictions.value.status).toBe("ALLOWED");
});
