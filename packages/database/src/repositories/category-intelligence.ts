import { Decimal } from "decimal.js";
import { Prisma } from "../generated/prisma/client.js";
import { db } from "../client.js";

export const CATEGORY_PAGE_LIMIT = 100;
export const CATEGORY_ANALYSIS_WINDOW_LIMIT = 1000;

export type CategoryAggregateRow = {
  id: string;
  asin: string | null;
  title: string;
  brand: string | null;
  category: string;
  marketplaceId: string | null;
  sources: string;
  price: { toString(): string } | null;
  reviewCount: bigint | null;
  priceVolatilityPercent: { toString(): string } | null;
  priceVolatility30Percent: { toString(): string } | null;
  reviewGrowth: { toString(): string } | null;
  reviewGrowth30: { toString(): string } | null;
  listingAgeDays: { toString(): string } | null;
  seasonalityStatus: string | null;
  historyStatus: string | null;
  amazonRetailPresence: string | null;
  opportunityScore: { toString(): string } | null;
  observedAt: Date | null;
};

type CategorySummaryRow = {
  category: string;
  marketplaceId: string | null;
  productCount: bigint;
};

function asText(value: { toString(): string } | bigint | null) {
  return value === null ? null : value.toString();
}

function median(values: Array<{ toString(): string } | bigint | null>) {
  const decimals = values
    .filter((value): value is { toString(): string } | bigint => value !== null)
    .map((value) => new Decimal(value.toString()))
    .sort((left, right) => left.comparedTo(right));
  if (!decimals.length) return null;
  const middle = Math.floor(decimals.length / 2);
  return (
    decimals.length % 2
      ? decimals[middle]!
      : decimals[middle]!.plus(decimals[middle - 1]!).div(2)
  ).toFixed(2);
}

function percentage(numerator: number, denominator: number) {
  return denominator
    ? new Decimal(numerator).div(denominator).times(100).toFixed(1)
    : null;
}

export function aggregateCategoryRows(rows: CategoryAggregateRow[]) {
  const brands = new Map<string, number>();
  for (const row of rows)
    brands.set(
      row.brand?.trim() || "Unbranded / unavailable",
      (brands.get(row.brand?.trim() || "Unbranded / unavailable") ?? 0) + 1,
    );
  const amazonKnown = rows.filter(
    (row) => row.amazonRetailPresence && row.amazonRetailPresence !== "UNKNOWN",
  );
  const lowReview = rows.filter(
    (row) => row.reviewCount !== null && row.reviewCount <= 100n,
  ).length;
  const stable = rows.filter(
    (row) =>
      row.priceVolatilityPercent !== null &&
      new Decimal(row.priceVolatilityPercent.toString()).lte(15),
  ).length;
  const newEntries = rows.filter(
    (row) =>
      row.listingAgeDays !== null &&
      new Decimal(row.listingAgeDays.toString()).lte(90),
  ).length;
  const seasonalKnown = rows.filter(
    (row) =>
      row.seasonalityStatus && row.seasonalityStatus !== "INSUFFICIENT_DATA",
  );
  const stableSeasonal = seasonalKnown.filter(
    (row) => row.seasonalityStatus === "COMPLETE",
  ).length;
  const topBrands = [...brands.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({
      name,
      count,
      sharePercent: percentage(count, rows.length),
    }));
  const concentration = rows.length
    ? [...brands.values()]
        .reduce(
          (total, count) =>
            total.plus(new Decimal(count).div(rows.length).pow(2)),
          new Decimal(0),
        )
        .times(10000)
        .toFixed(0)
    : null;
  const ranked = [...rows]
    .filter((row) => row.reviewGrowth !== null)
    .sort((a, b) =>
      new Decimal(b.reviewGrowth!.toString()).comparedTo(
        a.reviewGrowth!.toString(),
      ),
    );
  const growthByBrand = new Map<string, { total: Decimal; count: number }>();
  for (const row of rows) {
    if (row.reviewGrowth === null) continue;
    const brand = row.brand?.trim() || "Unbranded / unavailable";
    const current = growthByBrand.get(brand) ?? {
      total: new Decimal(0),
      count: 0,
    };
    growthByBrand.set(brand, {
      total: current.total.plus(row.reviewGrowth.toString()),
      count: current.count + 1,
    });
  }
  const rankedBrands = [...growthByBrand.entries()]
    .map(([name, value]) => ({
      name,
      reviewGrowth: value.total.div(value.count).toFixed(2),
      observedProductCount: value.count,
    }))
    .sort((left, right) =>
      new Decimal(right.reviewGrowth).comparedTo(left.reviewGrowth),
    );
  return {
    medianPrice: median(rows.map((row) => row.price)),
    medianReviews: median(rows.map((row) => row.reviewCount)),
    medianPriceVolatilityPercent: median(
      rows.map((row) => row.priceVolatilityPercent),
    ),
    timeWindowComparison: {
      days30: {
        medianPriceVolatilityPercent: median(
          rows.map((row) => row.priceVolatility30Percent),
        ),
        observedPriceVolatilityCount: rows.filter(
          (row) => row.priceVolatility30Percent !== null,
        ).length,
        medianReviewGrowth: median(rows.map((row) => row.reviewGrowth30)),
        observedReviewGrowthCount: rows.filter(
          (row) => row.reviewGrowth30 !== null,
        ).length,
      },
      days90: {
        medianPriceVolatilityPercent: median(
          rows.map((row) => row.priceVolatilityPercent),
        ),
        observedPriceVolatilityCount: rows.filter(
          (row) => row.priceVolatilityPercent !== null,
        ).length,
        medianReviewGrowth: median(rows.map((row) => row.reviewGrowth)),
        observedReviewGrowthCount: rows.filter(
          (row) => row.reviewGrowth !== null,
        ).length,
      },
    },
    medianOpportunityScore: median(rows.map((row) => row.opportunityScore)),
    reviewBarrier: {
      lowReviewCount: lowReview,
      observedCount: rows.filter((row) => row.reviewCount !== null).length,
    },
    brandConcentration: { hhi: concentration, topBrands },
    amazonRetail: {
      presentCount: rows.filter((row) => row.amazonRetailPresence === "PRESENT")
        .length,
      knownCount: amazonKnown.length,
    },
    newProductEntry: {
      recentCount: newEntries,
      observedCount: rows.filter((row) => row.listingAgeDays !== null).length,
    },
    seasonality: {
      stableCount: stableSeasonal,
      observedCount: seasonalKnown.length,
    },
    priceStability: {
      stableCount: stable,
      observedCount: rows.filter((row) => row.priceVolatilityPercent !== null)
        .length,
    },
    topReviewGrowthProducts: ranked.slice(0, 5).map((row) => ({
      id: row.id,
      asin: row.asin,
      title: row.title,
      brand: row.brand,
      reviewGrowth: asText(row.reviewGrowth),
    })),
    decliningReviewGrowthProducts: ranked
      .slice(-5)
      .reverse()
      .map((row) => ({
        id: row.id,
        asin: row.asin,
        title: row.title,
        brand: row.brand,
        reviewGrowth: asText(row.reviewGrowth),
      })),
    topReviewGrowthBrands: rankedBrands.slice(0, 5),
    decliningReviewGrowthBrands: rankedBrands.slice(-5).reverse(),
  };
}

/** Same strict tenant ownership boundary as Product Explorer. Category labels
 * come from observed product types, not an invented Amazon taxonomy. */
function baseQuery(organizationId: string) {
  return Prisma.sql`
    WITH product_universe AS (
      SELECT catalog_product_id AS product_id, 'IMPORTED_MATCH'::text AS source FROM listing_candidates WHERE organization_id = ${organizationId}
      UNION SELECT catalog_product_id, 'PROJECT'::text FROM research_project_items WHERE organization_id = ${organizationId} AND kind = 'PRODUCT' AND catalog_product_id IS NOT NULL
      UNION SELECT catalog_product_id, 'WATCH'::text FROM product_watches WHERE organization_id = ${organizationId} AND status = 'ACTIVE'
      UNION SELECT catalog_product_id, 'MARKET_MEMBER'::text FROM market_members WHERE organization_id = ${organizationId} AND left_at IS NULL
      UNION SELECT catalog_product_id, 'HISTORY_REFRESH'::text FROM history_refresh_items WHERE organization_id = ${organizationId} AND catalog_product_id IS NOT NULL
    ), source_rollup AS (
      SELECT product_id, string_agg(DISTINCT source, ',' ORDER BY source) AS sources FROM product_universe GROUP BY product_id
    ), category_data AS (
      SELECT cp.id, cp.asin, cp.title, cp.brand, COALESCE(NULLIF(cp.identity_projection -> 'productTypes' ->> 0, ''), 'Uncategorized (provider did not supply a category)') AS category, cp.marketplace_id AS "marketplaceId", sr.sources,
        pricing.featured_price AS price, review_count.integer_value AS "reviewCount",
        (analytics.metrics #>> '{price,90,volatilityPercent}')::numeric AS "priceVolatilityPercent",
        (analytics.metrics #>> '{price,30,volatilityPercent}')::numeric AS "priceVolatility30Percent",
        (analytics.metrics #>> '{reviewCountGrowth,90,growth}')::numeric AS "reviewGrowth",
        (analytics.metrics #>> '{reviewCountGrowth,30,growth}')::numeric AS "reviewGrowth30",
        (analytics.metrics ->> 'estimatedListingAgeDays')::numeric AS "listingAgeDays",
        analytics.metrics #>> '{seasonalIndex,status}' AS "seasonalityStatus", analytics.status::text AS "historyStatus",
        pricing.amazon_retail_presence::text AS "amazonRetailPresence", opportunity.score AS "opportunityScore", pricing.observed_at AS "observedAt"
      FROM source_rollup sr JOIN catalog_products cp ON cp.id = sr.product_id
      LEFT JOIN LATERAL (SELECT * FROM history_analytics_assessments WHERE organization_id = ${organizationId} AND catalog_product_id = cp.id ORDER BY calculated_at DESC LIMIT 1) analytics ON true
      LEFT JOIN LATERAL (SELECT po.* FROM listing_candidates lc JOIN enrichment_items ei ON ei.supplier_row_id = lc.supplier_row_id JOIN provider_observations po ON po.enrichment_item_id = ei.id WHERE lc.organization_id = ${organizationId} AND lc.catalog_product_id = cp.id AND po.metric_type = 'PRICING' AND po.observation_status = 'SUCCESS' ORDER BY po.observed_at DESC LIMIT 1) pricing ON true
      LEFT JOIN LATERAL (SELECT hmp.integer_value FROM historical_metric_series hms JOIN historical_metric_points hmp ON hmp.series_id = hms.id WHERE hms.organization_id = ${organizationId} AND hms.catalog_product_id = cp.id AND hms.metric_key = 'REVIEW_COUNT' ORDER BY hmp.metric_at DESC LIMIT 1) review_count ON true
      LEFT JOIN LATERAL (SELECT oa.score FROM opportunity_assessments oa WHERE oa.organization_id = ${organizationId} AND oa.catalog_product_id = cp.id ORDER BY oa.calculated_at DESC LIMIT 1) opportunity ON true
    )`;
}

export async function listCategoryIntelligence(input: {
  organizationId: string;
  offset: number;
  limit: number;
  marketplaceId?: string | undefined;
}) {
  const base = baseQuery(input.organizationId);
  const limit = Math.min(Math.max(input.limit, 1), CATEGORY_PAGE_LIMIT);
  const marketplace = input.marketplaceId
    ? Prisma.sql`WHERE "marketplaceId" = ${input.marketplaceId}`
    : Prisma.empty;
  const [rows, total] = await Promise.all([
    db.$queryRaw<CategorySummaryRow[]>(
      Prisma.sql`${base} SELECT category, "marketplaceId", count(*)::bigint AS "productCount" FROM category_data ${marketplace} GROUP BY category, "marketplaceId" ORDER BY "productCount" DESC, category ASC LIMIT ${limit} OFFSET ${input.offset}`,
    ),
    db.$queryRaw<Array<{ count: bigint }>>(
      Prisma.sql`${base} SELECT count(*)::bigint AS count FROM (SELECT DISTINCT category, "marketplaceId" FROM category_data ${marketplace}) categories`,
    ),
  ]);
  return {
    total: Number(total[0]?.count ?? 0),
    generatedAt: new Date().toISOString(),
    rows: rows.map((row) => ({
      categoryReference: row.category,
      categoryName: row.category,
      marketplaceId: row.marketplaceId,
      trackedProductCount: Number(row.productCount),
      universe:
        "Organization tracked / imported / watched / market-member products",
    })),
  };
}

export async function getCategoryIntelligence(input: {
  organizationId: string;
  categoryReference: string;
  offset: number;
  limit: number;
  marketplaceId?: string | undefined;
}) {
  const base = baseQuery(input.organizationId);
  const category = input.categoryReference.trim();
  const limit = Math.min(Math.max(input.limit, 1), CATEGORY_PAGE_LIMIT);
  const where = input.marketplaceId
    ? Prisma.sql`WHERE category = ${category} AND "marketplaceId" = ${input.marketplaceId}`
    : Prisma.sql`WHERE category = ${category}`;
  const [count, rows, analysisRows] = await Promise.all([
    db.$queryRaw<Array<{ count: bigint }>>(
      Prisma.sql`${base} SELECT count(*)::bigint AS count FROM category_data ${where}`,
    ),
    db.$queryRaw<CategoryAggregateRow[]>(
      Prisma.sql`${base} SELECT * FROM category_data ${where} ORDER BY title ASC, id ASC LIMIT ${limit} OFFSET ${input.offset}`,
    ),
    db.$queryRaw<CategoryAggregateRow[]>(
      Prisma.sql`${base} SELECT * FROM category_data ${where} ORDER BY title ASC, id ASC LIMIT ${CATEGORY_ANALYSIS_WINDOW_LIMIT}`,
    ),
  ]);
  const total = Number(count[0]?.count ?? 0);
  return {
    categoryReference: category,
    categoryName: category,
    total,
    generatedAt: new Date().toISOString(),
    universe:
      "Organization tracked / imported / watched / market-member products",
    analysisWindowCount: analysisRows.length,
    aggregate: aggregateCategoryRows(analysisRows),
    unavailableMetrics: [
      "Estimated monthly units and revenue are unavailable: no licensed demand-estimate provider is connected for this category.",
      "Seller concentration is unavailable: the current evidence records offer counts, not seller-level membership.",
      "Market size is unavailable: this is a tracked-universe aggregate, not an Amazon-wide category census.",
      "Category margin is unavailable: it requires product purchase-cost, fee, and fulfillment assumptions and is not a category aggregate.",
      "Top growing/declining uses stored 90-day review growth only; it is not a sales-growth estimate.",
    ],
    products: rows.map((row) => ({
      id: row.id,
      asin: row.asin,
      title: row.title,
      brand: row.brand,
      price: asText(row.price),
      reviewCount: asText(row.reviewCount),
      priceVolatilityPercent: asText(row.priceVolatilityPercent),
      reviewGrowth: asText(row.reviewGrowth),
      historyStatus: row.historyStatus,
      sources: row.sources.split(","),
    })),
  };
}
