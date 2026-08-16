import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderError } from "@rizpoint/provider-contracts";
import { AmazonSpApiProvider } from "../src/index.js";

const config = {
  clientId: "client-id",
  clientSecret: "client-secret",
  endpoint: "https://sellingpartnerapi-na.amazon.com",
};
const marketplace = { marketplaceId: "ATVPDKIKX0DER", region: "NA" as const };

function response(body: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function batch(body: Record<string, unknown>) {
  return {
    responses: [
      {
        status: { statusCode: 200, reasonPhrase: "Success" },
        body: { asin: "B000000001", marketplaceId: "ATVPDKIKX0DER", ...body },
      },
    ],
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("Product Pricing competitive summary", () => {
  it("batches up to 20 ASINs with documented New Consumer lowest-offer inputs", async () => {
    const requests: unknown[] = [];
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)));
      return response({
        responses: ["B000000001", "B000000002"].map((asin) => ({
          status: { statusCode: 200 },
          body: {
            asin,
            marketplaceId: marketplace.marketplaceId,
            featuredBuyingOptions: [],
            lowestPricedOffers: [],
          },
        })),
      });
    });
    const provider = new AmazonSpApiProvider(config, async () => "token");
    const values = await provider.getCompetitivePricingBatch(
      ["B000000001", "B000000002"],
      marketplace,
    );

    expect(values.map((value) => value.asin)).toEqual([
      "B000000001",
      "B000000002",
    ]);
    expect(values.every((value) => value.status === "SUCCESS")).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      requests: [
        {
          asin: "B000000001",
          includedData: ["featuredBuyingOptions", "lowestPricedOffers"],
          lowestPricedOffersInputs: [
            { itemCondition: "New", offerType: "Consumer" },
          ],
        },
        { asin: "B000000002" },
      ],
    });
    expect(
      (requests[0] as { requests: Array<{ uri: string }> }).requests.map(
        (request) => request.uri,
      ),
    ).toEqual([
      "/products/pricing/2022-05-01/items/competitiveSummary",
      "/products/pricing/2022-05-01/items/competitiveSummary",
    ]);
  });

  it("rejects duplicate and oversized batches before a provider call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const provider = new AmazonSpApiProvider(config, async () => "token");
    await expect(
      provider.getCompetitivePricingBatch(
        ["B000000001", "B000000001"],
        marketplace,
      ),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(
      provider.getCompetitivePricingBatch(
        Array.from(
          { length: 21 },
          (_, index) => `B${String(index).padStart(9, "0")}`,
        ),
        marketplace,
      ),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps an item-level throttle separate from successful batch neighbors", async () => {
    vi.stubGlobal("fetch", async () =>
      response({
        responses: [
          {
            status: { statusCode: 200 },
            body: {
              asin: "B000000001",
              marketplaceId: marketplace.marketplaceId,
              featuredBuyingOptions: [],
              lowestPricedOffers: [],
            },
          },
          {
            status: { statusCode: 429 },
            body: {
              asin: "B000000002",
              marketplaceId: marketplace.marketplaceId,
            },
          },
        ],
      }),
    );
    const provider = new AmazonSpApiProvider(config, async () => "token");
    const results = await provider.getCompetitivePricingBatch(
      ["B000000001", "B000000002"],
      marketplace,
    );
    expect(results[0]).toMatchObject({
      asin: "B000000001",
      status: "SUCCESS",
    });
    expect(results[1]).toEqual({
      asin: "B000000002",
      status: "ERROR",
      error: { code: "THROTTLED", httpStatus: 429 },
    });
  });

  it("projects featured, FBA, and FBM offers without treating FBA as Amazon Retail", async () => {
    vi.stubGlobal("fetch", async () =>
      response(
        batch({
          featuredBuyingOptions: [
            {
              buyingOptionType: "New",
              segmentedFeaturedOffers: [
                {
                  sellerId: "third-party-fba",
                  condition: "New",
                  fulfillmentType: "AFN",
                  listingPrice: { amount: 18.11, currencyCode: "USD" },
                  shippingOptions: [
                    {
                      shippingOptionType: "DEFAULT",
                      price: { amount: 2.5, currencyCode: "USD" },
                    },
                  ],
                  featuredOfferSegments: [
                    { customerMembership: "DEFAULT", segmentDetails: {} },
                  ],
                },
              ],
            },
          ],
          lowestPricedOffers: [
            {
              lowestPricedOffersInput: {
                itemCondition: "New",
                offerType: "Consumer",
              },
              offers: [
                {
                  sellerId: "third-party-fba",
                  condition: "New",
                  fulfillmentType: "AFN",
                  listingPrice: { amount: 17, currencyCode: "USD" },
                },
                {
                  sellerId: "third-party-fbm",
                  condition: "New",
                  fulfillmentType: "MFN",
                  listingPrice: { amount: 16.5, currencyCode: "USD" },
                  shippingOptions: [
                    {
                      shippingOptionType: "DEFAULT",
                      price: { amount: 1.25, currencyCode: "USD" },
                    },
                  ],
                },
              ],
            },
          ],
        }),
        200,
        { "x-amzn-requestid": "pricing-request-1" },
      ),
    );
    const provider = new AmazonSpApiProvider(config, async () => "token");
    const pricing = await provider.getCompetitivePricing(
      "B000000001",
      marketplace,
    );
    expect(pricing.value).toMatchObject({
      featuredOfferState: "PRESENT",
      buyBoxPrice: "20.61",
      amazonRetailPresence: "UNKNOWN",
      totalVisibleOffers: { value: 2, completeness: "PARTIAL" },
      fbaVisibleOffers: { value: 1, completeness: "PARTIAL" },
      fbmVisibleOffers: { value: 1, completeness: "PARTIAL" },
      lowestFbaPrice: "17",
      lowestFbmPrice: "17.75",
    });
    expect(pricing.value.featuredOffer?.fulfillmentChannel).toBe("AMAZON");
    expect(pricing.value.amazonRetailPresence).not.toBe("PRESENT");
    expect(pricing.provenance).toMatchObject({
      requestId: "pricing-request-1",
      responseCompleteness: "COMPLETE",
    });
  });

  it.each([
    [
      { featuredBuyingOptions: [], lowestPricedOffers: [] },
      "ABSENT",
      "COMPLETE",
    ],
    [{}, "UNKNOWN", "PARTIAL"],
  ] as const)(
    "keeps absent and unknown distinct",
    async (body, state, completeness) => {
      vi.stubGlobal("fetch", async () => response(batch(body)));
      const provider = new AmazonSpApiProvider(config, async () => "token");
      const pricing = await provider.getCompetitivePricing(
        "B000000001",
        marketplace,
      );
      expect(pricing.value.featuredOfferState).toBe(state);
      expect(pricing.value.completeness).toBe(completeness);
      if (state === "UNKNOWN") {
        expect(pricing.value.totalVisibleOffers).toEqual({
          completeness: "UNKNOWN",
        });
        expect(pricing.value.amazonRetailPresence).toBe("UNKNOWN");
      }
    },
  );

  it("marks currency-mismatched price components partial", async () => {
    vi.stubGlobal("fetch", async () =>
      response(
        batch({
          featuredBuyingOptions: [
            {
              segmentedFeaturedOffers: [
                {
                  sellerId: "seller",
                  condition: "New",
                  fulfillmentType: "MFN",
                  listingPrice: { amount: 10, currencyCode: "USD" },
                  shippingOptions: [
                    {
                      shippingOptionType: "DEFAULT",
                      price: { amount: 1, currencyCode: "CAD" },
                    },
                  ],
                  featuredOfferSegments: [],
                },
              ],
            },
          ],
          lowestPricedOffers: [],
        }),
      ),
    );
    const provider = new AmazonSpApiProvider(config, async () => "token");
    const pricing = await provider.getCompetitivePricing(
      "B000000001",
      marketplace,
    );
    expect(pricing.value.completeness).toBe("PARTIAL");
    expect(pricing.value.buyBoxPrice).toBeUndefined();
  });

  it.each([
    [401, "UNAUTHORIZED"],
    [429, "THROTTLED"],
    [503, "PROVIDER_OUTAGE"],
  ] as const)("maps batch item %i to %s", async (status, code) => {
    vi.stubGlobal("fetch", async () =>
      response({ responses: [{ status: { statusCode: status }, body: {} }] }),
    );
    const provider = new AmazonSpApiProvider(config, async () => "token");
    await expect(
      provider.getCompetitivePricing("B000000001", marketplace),
    ).rejects.toMatchObject({ code } satisfies Partial<ProviderError>);
  });
});
