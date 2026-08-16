import { describe, expect, it } from "vitest";
import { RecordedMarketHistoryProvider } from "../src/index.js";

const marketplace = { marketplaceId: "ATVPDKIKX0DER", region: "NA" as const };

describe("RecordedMarketHistoryProvider", () => {
  it("marks sparse fixtures as partial without inventing missing metrics", async () => {
    const result = await new RecordedMarketHistoryProvider({ sparse: true })
      .getProductHistory!(
      {
        asins: ["B000000001"],
        historyDays: 365,
        includeRatingAndReviews: true,
      },
      marketplace,
    );
    expect(result.provenance.provider).toBe("recorded-history");
    expect(result.value.products[0]?.completeness).toBe("PARTIAL");
    expect(
      result.value.products[0]?.series.some(
        (item) => item.metricKey === "REVIEW_COUNT",
      ),
    ).toBe(false);
  });

  it("keeps provider failure semantics explicit", async () => {
    await expect(
      new RecordedMarketHistoryProvider({ fault: "THROTTLED" })
        .getProductHistory!(
        {
          asins: ["B000000001"],
          historyDays: 1,
          includeRatingAndReviews: false,
        },
        marketplace,
      ),
    ).rejects.toMatchObject({
      code: "THROTTLED",
      options: { retryAfterMs: 2_000 },
    });
  });
});
