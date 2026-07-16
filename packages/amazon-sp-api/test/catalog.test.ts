import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderError } from "@rizpoint/provider-contracts";
import { AmazonSpApiProvider } from "../src/index.js";

const config = {
  clientId: "client-id",
  clientSecret: "client-secret",
  endpoint: "https://sellingpartnerapi-na.amazon.com",
};
const marketplace = { marketplaceId: "ATVPDKIKX0DER", region: "NA" as const };
const catalogItem = {
  asin: "B000000001",
  summaries: [
    {
      itemName: "Acme Soda 12 oz Pack of 6",
      brandName: "Acme",
      manufacturer: "Acme Foods",
      modelNumber: "LEMON-12",
      colorName: "Yellow",
      sizeName: "12 oz",
    },
  ],
  attributes: [
    {
      packageQuantity: [{ value: "6" }],
      variationTheme: [{ value: "Flavor" }],
    },
  ],
  identifiers: [
    { identifiers: [{ identifierType: "UPC", identifier: "012345678905" }] },
  ],
  images: [
    {
      images: [
        {
          link: "https://images-na.ssl-images-amazon.com/images/I/example.jpg",
          variant: "MAIN",
          height: 500,
          width: 500,
        },
      ],
    },
  ],
  productTypes: [{ productType: "GROCERY" }],
  relationships: [
    {
      relationships: [
        {
          type: "VARIATION",
          parentAsins: ["B000000002"],
          childAsins: ["B000000003"],
        },
      ],
    },
  ],
  salesRanks: [{ classificationId: "GROCERY", rank: 42 }],
  dimensions: [
    {
      height: { value: 2 },
      length: { value: 8 },
      width: { value: 4 },
      weight: { value: 1 },
      unitOfMeasure: "IN",
    },
  ],
};

function response(
  body: unknown,
  status = 200,
  headers?: HeadersInit,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("Catalog Items identity projection", () => {
  it("preserves leading-zero identifiers and projects permitted catalog identity data", async () => {
    const fetch = vi.fn(async () =>
      response({ items: [catalogItem] }, 200, {
        "x-amzn-requestid": "request-1",
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const provider = new AmazonSpApiProvider(
      config,
      async () => "access-token",
    );
    const products = await provider.searchByIdentifier(
      { type: "UPC", value: "012345678905" },
      marketplace,
    );
    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({
      asin: "B000000001",
      manufacturer: "Acme Foods",
      packCount: 6,
      variationTheme: "Flavor",
      identifiers: [{ type: "UPC", value: "012345678905" }],
      provenance: {
        marketplaceId: "ATVPDKIKX0DER",
        requestId: "request-1",
        responseCompleteness: "COMPLETE",
      },
    });
    expect(products[0]?.images?.[0]?.url).toMatch(/^https:/);
    expect(String(fetch.mock.calls[0]?.[0])).toContain("identifiersType=UPC");
  });

  it("enforces Catalog Items identifier batch and keeps partial responses explicit", async () => {
    vi.stubGlobal("fetch", async () =>
      response({
        items: [{ asin: "B000000001", summaries: catalogItem.summaries }],
      }),
    );
    const provider = new AmazonSpApiProvider(
      config,
      async () => "access-token",
    );
    await expect(
      provider.searchByIdentifiers(
        Array.from({ length: 21 }, () => ({
          type: "UPC" as const,
          value: "012345678905",
        })),
        marketplace,
      ),
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    } satisfies Partial<ProviderError>);
    const product = await provider.getItem("B000000001", marketplace);
    expect(product?.provenance.responseCompleteness).toBe("PARTIAL");
  });

  it("keeps throttling distinct and forwards Retry-After for worker resume", async () => {
    vi.stubGlobal("fetch", async () =>
      response({}, 429, { "retry-after": "2" }),
    );
    const provider = new AmazonSpApiProvider(
      config,
      async () => "access-token",
    );
    await expect(
      provider.getItem("B000000001", marketplace),
    ).rejects.toMatchObject({
      code: "THROTTLED",
      options: { retryAfterMs: 2_000 },
    } satisfies Partial<ProviderError>);
  });
});
