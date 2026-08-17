import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import {
  aggregateCategoryRows,
  type CategoryAggregateRow,
} from "../src/repositories/category-intelligence.js";

function row(
  overrides: Partial<CategoryAggregateRow> = {},
): CategoryAggregateRow {
  return {
    id: "product",
    asin: "B000000001",
    title: "Product",
    brand: "Brand A",
    category: "Home",
    marketplaceId: "ATVPDKIKX0DER",
    sources: "PROJECT",
    price: null,
    reviewCount: null,
    priceVolatilityPercent: null,
    priceVolatility30Percent: null,
    reviewGrowth: null,
    reviewGrowth30: null,
    listingAgeDays: null,
    seasonalityStatus: null,
    historyStatus: null,
    amazonRetailPresence: null,
    opportunityScore: null,
    observedAt: null,
    ...overrides,
  };
}

describe("category intelligence aggregate math", () => {
  it("uses Decimal medians and only observed values in sparse categories", () => {
    const result = aggregateCategoryRows([
      row({
        id: "a",
        price: { toString: () => "10.10" },
        reviewCount: 10n,
        priceVolatilityPercent: { toString: () => "12.5" },
        priceVolatility30Percent: { toString: () => "9.5" },
        reviewGrowth30: { toString: () => "3" },
        amazonRetailPresence: "PRESENT",
      }),
      row({
        id: "b",
        brand: "Brand B",
        price: { toString: () => "20.20" },
        reviewCount: 200n,
        priceVolatilityPercent: { toString: () => "16.0" },
        priceVolatility30Percent: { toString: () => "20.0" },
        reviewGrowth30: { toString: () => "1" },
        amazonRetailPresence: "ABSENT",
      }),
      row({ id: "c", brand: "Brand B" }),
    ]);
    expect(result.medianPrice).toBe("15.15");
    expect(result.medianReviews).toBe("105.00");
    expect(result.reviewBarrier).toEqual({
      lowReviewCount: 1,
      observedCount: 2,
    });
    expect(result.priceStability).toEqual({ stableCount: 1, observedCount: 2 });
    expect(result.amazonRetail).toEqual({ presentCount: 1, knownCount: 2 });
    expect(result.brandConcentration.hhi).toBe("5556");
    expect(result.timeWindowComparison.days30).toMatchObject({
      medianPriceVolatilityPercent: "14.75",
      medianReviewGrowth: "2.00",
    });
  });

  it("reports no derived metric for an empty category window", () => {
    const result = aggregateCategoryRows([]);
    expect(result.medianPrice).toBeNull();
    expect(result.medianReviews).toBeNull();
    expect(result.brandConcentration.hhi).toBeNull();
    expect(result.topReviewGrowthProducts).toEqual([]);
  });
});

describe("category intelligence query boundary", () => {
  it("uses only the tenant evidence union and bounded server windows", async () => {
    const source = await readFile(
      new URL("../src/repositories/category-intelligence.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("FROM listing_candidates");
    expect(source).toContain("FROM research_project_items");
    expect(source).toContain("FROM product_watches");
    expect(source).toContain("FROM market_members");
    expect(source).toContain("CATEGORY_ANALYSIS_WINDOW_LIMIT = 1000");
    expect(source).toContain("LIMIT ${limit} OFFSET ${input.offset}");
    expect(source).not.toContain("FROM catalog_products cp\n      ORDER BY");
  });
});
