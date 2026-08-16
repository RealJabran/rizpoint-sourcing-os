import { describe, expect, it, vi } from "vitest";
import {
  KeepaMarketHistoryProvider,
  KEEPA_MAX_ASINS_PER_PRODUCT_REQUEST,
} from "../src/index.js";

const marketplace = { marketplaceId: "ATVPDKIKX0DER", region: "NA" as const };

function response(
  body: unknown,
  status = 200,
  headers?: Record<string, string>,
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
  };
}

describe("KeepaMarketHistoryProvider", () => {
  it("normalizes sparse history without converting missing values into zeroes", async () => {
    const fetcher = vi.fn(async () =>
      response({
        products: [
          {
            asin: "B000000001",
            trackingSince: 7_889_760,
            csv: [
              [7_889_760, 1999, 7_889_761, -1],
              [7_889_760, 1899],
              [],
              [7_889_760, 1234],
              [],
              [],
              [],
              [],
              [],
              [],
              [],
              [7_889_760, 4],
            ],
            rating: 450,
            reviewCount: 19,
            categoryTree: [{ catId: 123, name: "Fixtures" }],
          },
        ],
      }),
    );
    const provider = new KeepaMarketHistoryProvider(
      { apiKey: "test-key" },
      fetcher,
      () => new Date("2026-01-15T00:00:00.000Z"),
    );

    const result = await provider.getProductHistory!(
      {
        asins: ["B000000001"],
        historyDays: 365,
        includeRatingAndReviews: true,
      },
      marketplace,
    );

    expect(result.value.products[0]?.series).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metricKey: "AMAZON_PRICE", currency: "USD" }),
        expect.objectContaining({ metricKey: "AMAZON_RETAIL_PRESENT" }),
        expect.objectContaining({ metricKey: "SALES_RANK" }),
        expect.objectContaining({ metricKey: "RATING" }),
      ]),
    );
    expect(
      result.value.products[0]?.series.find(
        (series) => series.metricKey === "AMAZON_PRICE",
      )?.points,
    ).toEqual([expect.objectContaining({ decimalValue: "19.99" })]);
    expect(
      result.value.products[0]?.series.find(
        (series) => series.metricKey === "AMAZON_RETAIL_PRESENT",
      )?.points,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ booleanValue: false }),
      ]),
    );
    // The actual HTTP request necessarily carries the key for Keepa's API,
    // but adapter results and all caller telemetry exclude it.
    expect(result.rawProviderObservation).not.toMatchObject({
      key: "test-key",
    });
  });

  it("reports a partial batch instead of claiming missing ASINs were returned", async () => {
    const provider = new KeepaMarketHistoryProvider(
      { apiKey: "secret" },
      async () => response({ products: [{ asin: "B000000001", csv: [] }] }),
    );
    const result = await provider.getProductHistory!(
      {
        asins: ["B000000001", "B000000002"],
        historyDays: 30,
        includeRatingAndReviews: false,
      },
      marketplace,
    );
    expect(result.value.products).toHaveLength(1);
    expect(result.provenance.responseCompleteness).toBe("PARTIAL");
  });

  it("maps authentication, throttle, and batch validation failures", async () => {
    const provider = new KeepaMarketHistoryProvider(
      { apiKey: "secret" },
      async () => response({}, 429, { "retry-after": "3" }),
    );
    await expect(
      provider.getProductHistory!(
        {
          asins: ["B000000001"],
          historyDays: 1,
          includeRatingAndReviews: false,
        },
        marketplace,
      ),
    ).rejects.toMatchObject({
      code: "THROTTLED",
      options: { retryAfterMs: 3_000 },
    });
    await expect(
      provider.getProductHistory!(
        {
          asins: Array.from(
            { length: KEEPA_MAX_ASINS_PER_PRODUCT_REQUEST + 1 },
            () => "B000000001",
          ),
          historyDays: 1,
          includeRatingAndReviews: false,
        },
        marketplace,
      ),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });
});
