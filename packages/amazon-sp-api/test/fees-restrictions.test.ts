import { afterEach, describe, expect, it, vi } from "vitest";
import { AmazonSpApiProvider } from "../src/index.js";

const marketplace = {
  marketplaceId: "ATVPDKIKX0DER",
  region: "NA" as const,
  sellerId: "seller-id",
};
const config = {
  clientId: "client-id",
  clientSecret: "client-secret",
  endpoint: "https://sellingpartnerapi-na.amazon.com",
};

function response(body: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function feePayload(overrides: Record<string, unknown> = {}) {
  return {
    payload: {
      FeesEstimateResult: {
        Status: "Success",
        FeesEstimateIdentifier: {
          MarketplaceId: marketplace.marketplaceId,
          IdValue: "B000000001",
          SellerInputIdentifier: "fee-request",
          IsAmazonFulfilled: true,
        },
        FeesEstimate: {
          TimeOfFeesEstimation: "2026-07-18T12:00:00Z",
          TotalFeesEstimate: { Amount: 5.25, CurrencyCode: "USD" },
          FeeDetailList: [
            {
              FeeType: "ReferralFee",
              FeeAmount: { Amount: 3, CurrencyCode: "USD" },
              FeePromotion: { Amount: 0, CurrencyCode: "USD" },
              TaxAmount: { Amount: 0.25, CurrencyCode: "USD" },
              FinalFee: { Amount: 3.25, CurrencyCode: "USD" },
            },
            {
              FeeType: "FBAFees",
              FeeAmount: { Amount: 2, CurrencyCode: "USD" },
              FinalFee: { Amount: 2, CurrencyCode: "USD" },
            },
          ],
        },
        ...overrides,
      },
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("Product Fees getMyFeesEstimateForASIN", () => {
  it("normalizes component money and retains scenario request lineage", async () => {
    const requests: unknown[] = [];
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)));
      return response(feePayload());
    });
    const provider = new AmazonSpApiProvider(config, async () => "token");
    const quote = await provider.estimateFees({
      asin: "B000000001",
      marketplace,
      fulfillmentChannel: "AMAZON",
      scenarioSource: "CURRENT_FEATURED_OFFER",
      price: "20.00",
      listingPrice: "19.00",
      shippingPrice: "1.00",
      currency: "USD",
      requestId: "fee-request",
    });

    expect(requests[0]).toMatchObject({
      FeesEstimateRequest: {
        MarketplaceId: marketplace.marketplaceId,
        IsAmazonFulfilled: true,
        Identifier: "fee-request",
        PriceToEstimateFees: {
          ListingPrice: { Amount: "19.00", CurrencyCode: "USD" },
          Shipping: { Amount: "1.00", CurrencyCode: "USD" },
        },
      },
    });
    expect(quote.value).toMatchObject({
      operation: "getMyFeesEstimateForASIN",
      totalFee: "5.25",
      quotedPrice: "20.00",
      completeness: "COMPLETE",
      scenarioSource: "CURRENT_FEATURED_OFFER",
      components: [
        {
          feeType: "ReferralFee",
          feeAmount: "3",
          finalFee: "3.25",
          tax: "0.25",
          currency: "USD",
        },
        {
          feeType: "FBAFees",
          feeAmount: "2",
          finalFee: "2",
          currency: "USD",
        },
      ],
    });
    expect(quote.rawProviderObservation).toBeDefined();
  });

  it("marks an aggregate-only success partial and maps result-level errors", async () => {
    vi.stubGlobal("fetch", async () =>
      response(
        feePayload({
          FeesEstimate: {
            TotalFeesEstimate: { Amount: 5.25, CurrencyCode: "USD" },
          },
        }),
      ),
    );
    const provider = new AmazonSpApiProvider(config, async () => "token");
    await expect(
      provider.estimateFees({
        asin: "B000000001",
        marketplace,
        fulfillmentChannel: "AMAZON",
        scenarioSource: "CURRENT_FEATURED_OFFER",
        price: "20.00",
        shippingPrice: "0",
        currency: "USD",
        requestId: "fee-request",
      }),
    ).resolves.toMatchObject({ value: { completeness: "PARTIAL" } });

    vi.stubGlobal("fetch", async () =>
      response(feePayload({ Status: "ServiceError" })),
    );
    const serviceErrorProvider = new AmazonSpApiProvider(
      config,
      async () => "token",
    );
    await expect(
      serviceErrorProvider.estimateFees({
        asin: "B000000001",
        marketplace,
        fulfillmentChannel: "AMAZON",
        scenarioSource: "CURRENT_FEATURED_OFFER",
        price: "20.00",
        shippingPrice: "0",
        currency: "USD",
        requestId: "fee-request",
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_OUTAGE" });
  });

  it("serializes concurrent fee requests and adapts to a returned rate limit", async () => {
    let concurrent = 0;
    let maximumConcurrent = 0;
    vi.stubGlobal("fetch", async () => {
      concurrent += 1;
      maximumConcurrent = Math.max(maximumConcurrent, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 5));
      concurrent -= 1;
      return response(feePayload(), 200, {
        "x-amzn-ratelimit-limit": "1000",
      });
    });
    const provider = new AmazonSpApiProvider(config, async () => "token");
    const request = {
      asin: "B000000001",
      marketplace,
      fulfillmentChannel: "AMAZON" as const,
      scenarioSource: "CURRENT_FEATURED_OFFER" as const,
      price: "20.00",
      shippingPrice: "0",
      currency: "USD",
      requestId: "fee-request",
    };
    await Promise.all([
      provider.estimateFees(request),
      provider.estimateFees(request),
    ]);
    expect(maximumConcurrent).toBe(1);
  });
});

describe("Listings Restrictions getListingsRestrictions", () => {
  it.each([
    [{ restrictions: [] }, "ELIGIBLE"],
    [
      {
        restrictions: [
          {
            marketplaceId: marketplace.marketplaceId,
            reasons: [
              {
                reasonCode: "APPROVAL_REQUIRED",
                message: "Apply for approval.",
                links: [],
              },
            ],
          },
        ],
      },
      "APPROVAL_REQUIRED",
    ],
    [
      {
        restrictions: [
          {
            marketplaceId: marketplace.marketplaceId,
            reasons: [
              {
                reasonCode: "NOT_ELIGIBLE",
                message: "This account is not eligible.",
              },
            ],
          },
        ],
      },
      "RESTRICTED",
    ],
    [
      {
        restrictions: [
          {
            marketplaceId: marketplace.marketplaceId,
            reasons: [{ message: "A reason code was not returned." }],
          },
        ],
      },
      "INCOMPLETE",
    ],
    [
      {
        restrictions: [
          {
            marketplaceId: marketplace.marketplaceId,
            reasons: [
              {
                reasonCode: "ASIN_NOT_FOUND",
                message: "The ASIN was not found in this marketplace.",
              },
            ],
          },
        ],
      },
      "INCOMPLETE",
    ],
  ] as const)("maps a successful response to %s", async (body, state) => {
    vi.stubGlobal("fetch", async () => response(body));
    const provider = new AmazonSpApiProvider(config, async () => "token");
    await expect(
      provider.getRestrictions("B000000001", marketplace),
    ).resolves.toMatchObject({ value: { state } });
  });

  it("never treats a missing restrictions collection as eligible", async () => {
    vi.stubGlobal("fetch", async () => response({}));
    const provider = new AmazonSpApiProvider(config, async () => "token");
    await expect(
      provider.getRestrictions("B000000001", marketplace),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});
