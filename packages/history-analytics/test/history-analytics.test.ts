import { describe, expect, it } from "vitest";
import {
  analyzeHistory,
  HISTORY_ANALYTICS_VERSION,
  type HistorySeries,
} from "../src/index.js";

const calculatedAt = "2026-08-16T00:00:00.000Z";

function dailySeries(
  metricKey: HistorySeries["metricKey"],
  values: readonly string[],
): HistorySeries {
  return {
    metricKey,
    providerKey: "recorded-history",
    unit: metricKey.includes("PRICE") ? "USD" : "COUNT",
    points: values.map((value, index) => ({
      id: `${metricKey}-${index}`,
      observedAt: new Date(
        Date.parse(calculatedAt) - (values.length - index) * 86_400_000,
      ).toISOString(),
      integerValue: value,
    })),
  };
}

describe("history analytics", () => {
  it("is deterministic and derives auditable price, BSR, offer, and review metrics", () => {
    const input = {
      providerKey: "recorded-history",
      calculatedAt,
      series: [
        dailySeries("FEATURED_OFFER_PRICE", [
          "1000",
          "1000",
          "1000",
          "900",
          "800",
          "700",
          "700",
          "800",
          "900",
          "1000",
        ]),
        dailySeries("SALES_RANK", [
          "100",
          "110",
          "90",
          "140",
          "120",
          "130",
          "125",
          "115",
          "105",
          "100",
        ]),
        dailySeries("OFFER_COUNT", [
          "5",
          "5",
          "6",
          "7",
          "6",
          "8",
          "8",
          "7",
          "6",
          "6",
        ]),
        dailySeries("REVIEW_COUNT", [
          "10",
          "11",
          "12",
          "14",
          "15",
          "16",
          "17",
          "18",
          "19",
          "20",
        ]),
        {
          metricKey: "AMAZON_RETAIL_PRESENT",
          providerKey: "recorded-history",
          unit: "BOOLEAN",
          points: [
            true,
            false,
            true,
            true,
            false,
            true,
            true,
            false,
            true,
            false,
          ].map((booleanValue, index) => ({
            id: `retail-${index}`,
            observedAt: new Date(
              Date.parse(calculatedAt) - (10 - index) * 86_400_000,
            ).toISOString(),
            booleanValue,
          })),
        },
      ],
    } as const;
    expect(analyzeHistory(input)).toEqual(analyzeHistory(input));
    const result = analyzeHistory(input);
    expect(result.version).toBe(HISTORY_ANALYTICS_VERSION);
    expect(result.priceSourceMetricKey).toBe("FEATURED_OFFER_PRICE");
    expect(result.price[30]).toMatchObject({
      median: "900.0000",
      conservativePercentile20: "700.0000",
    });
    expect(result.price[30].maxDrawdownPercent).toBe("-30.00");
    expect(result.amazonRetailPresence[30].presentPercent).toBe("60.00");
    expect(result.reviewCountGrowth[30].growth).toBe("10.0000");
  });

  it("never turns sparse observations or missing months into zero-valued analytics", () => {
    const sparse = analyzeHistory({
      providerKey: "recorded-history",
      calculatedAt,
      series: [dailySeries("AMAZON_PRICE", ["19", "18"])],
    });
    expect(sparse.status).toBe("INSUFFICIENT_DATA");
    expect(sparse.price[30]).toEqual({
      status: "INSUFFICIENT_DATA",
      coverage: expect.objectContaining({
        observations: 2,
        confidence: "INSUFFICIENT",
      }),
    });
    expect(sparse.seasonalIndex).toMatchObject({ status: "INSUFFICIENT_DATA" });
    expect(sparse.price[30].median).toBeUndefined();
  });

  it("uses a provider first-observed fact only as an explicitly estimated listing age", () => {
    const result = analyzeHistory({
      providerKey: "recorded-history",
      calculatedAt,
      series: [
        dailySeries("AMAZON_PRICE", ["20", "20", "20", "20", "20"]),
        {
          metricKey: "PRODUCT_FIRST_OBSERVED_AT",
          providerKey: "recorded-history",
          unit: "ISO_DATETIME",
          points: [
            {
              id: "first",
              observedAt: calculatedAt,
              textValue: "2025-08-16T00:00:00.000Z",
            },
          ],
        },
      ],
    });
    expect(result.firstObservedAt).toBe("2025-08-16T00:00:00.000Z");
    expect(result.estimatedListingAgeDays).toBe("365.0");
  });
});
