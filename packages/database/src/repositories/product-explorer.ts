import { Prisma } from "../generated/prisma/client.js";
import { db } from "../client.js";
import { withInteractiveResearchQuery } from "../research-performance.js";

export const PRODUCT_EXPLORER_VIEW_SCHEMA_VERSION = 1;
export const PRODUCT_EXPLORER_PAGE_LIMIT = 100;

export type ProductExplorerFilters = {
  marketplaceId?: string | undefined;
  search?: string | undefined;
  brand?: string | undefined;
  category?: string | undefined;
  minPrice?: string | undefined;
  maxPrice?: string | undefined;
  maxReviewCount?: number | undefined;
  maxPriceVolatilityPercent?: string | undefined;
  dataCompleteness?: "COMPLETE" | "PARTIAL" | "INSUFFICIENT_DATA" | undefined;
};

type RawExplorerRow = {
  id: string;
  asin: string | null;
  title: string;
  brand: string | null;
  marketplaceId: string | null;
  category: string | null;
  catalogProvider: string;
  sources: string;
  price: { toString(): string } | null;
  currency: string | null;
  rating: { toString(): string } | null;
  reviewCount: bigint | null;
  salesRank: number | null;
  offerCount: number | null;
  fbaOfferCount: number | null;
  fbmOfferCount: number | null;
  amazonRetailPresence: string | null;
  priceVolatilityPercent: { toString(): string } | null;
  reviewGrowth: { toString(): string } | null;
  listingAgeDays: { toString(): string } | null;
  seasonalityStatus: string | null;
  historyStatus: string | null;
  historyCoveragePercent: { toString(): string } | null;
  freshnessState: string | null;
  observedAt: Date | null;
  pricingProvider: string | null;
  historyProvider: string | null;
};

function text(value: { toString(): string } | bigint | null): string | null {
  return value === null ? null : value.toString();
}

/**
 * This is deliberately a tenant-universe query, not a catalog table browse.
 * A CatalogProduct becomes visible only when the organization has imported it,
 * saved it to a project, put it in a market, watched it, or refreshed history.
 */
function baseQuery(organizationId: string) {
  return Prisma.sql`
    WITH product_universe AS (
      SELECT lc.catalog_product_id AS product_id, 'IMPORTED_MATCH'::text AS source
      FROM listing_candidates lc
      WHERE lc.organization_id = ${organizationId}
      UNION
      SELECT rpi.catalog_product_id, 'PROJECT'::text
      FROM research_project_items rpi
      WHERE rpi.organization_id = ${organizationId}
        AND rpi.kind = 'PRODUCT'
        AND rpi.catalog_product_id IS NOT NULL
      UNION
      SELECT pw.catalog_product_id, 'WATCH'::text
      FROM product_watches pw
      WHERE pw.organization_id = ${organizationId}
        AND pw.status = 'ACTIVE'
      UNION
      SELECT mm.catalog_product_id, 'MARKET_MEMBER'::text
      FROM market_members mm
      WHERE mm.organization_id = ${organizationId}
        AND mm.left_at IS NULL
      UNION
      SELECT hri.catalog_product_id, 'HISTORY_REFRESH'::text
      FROM history_refresh_items hri
      WHERE hri.organization_id = ${organizationId}
        AND hri.catalog_product_id IS NOT NULL
    ), source_rollup AS (
      SELECT product_id, string_agg(DISTINCT source, ',' ORDER BY source) AS sources
      FROM product_universe
      GROUP BY product_id
    ), explorer_data AS (
      SELECT
        cp.id,
        cp.asin,
        cp.title,
        cp.brand,
        cp.marketplace_id AS "marketplaceId",
        cp.identity_projection -> 'productTypes' ->> 0 AS category,
        cp.provider::text AS "catalogProvider",
        sr.sources,
        pricing.featured_price AS price,
        pricing.featured_currency AS currency,
        rating.decimal_value AS rating,
        review_count.integer_value AS "reviewCount",
        rank_point.integer_value::int AS "salesRank",
        pricing.visible_offer_count AS "offerCount",
        pricing.fba_offer_count AS "fbaOfferCount",
        pricing.fbm_offer_count AS "fbmOfferCount",
        pricing.amazon_retail_presence::text AS "amazonRetailPresence",
        (analytics.metrics #>> '{price,90,volatilityPercent}')::numeric AS "priceVolatilityPercent",
        (analytics.metrics #>> '{reviewCountGrowth,90,growth}')::numeric AS "reviewGrowth",
        (analytics.metrics ->> 'estimatedListingAgeDays')::numeric AS "listingAgeDays",
        analytics.metrics #>> '{seasonalIndex,status}' AS "seasonalityStatus",
        analytics.status::text AS "historyStatus",
        analytics.coverage_percent AS "historyCoveragePercent",
        pricing.freshness_state::text AS "freshnessState",
        pricing.observed_at AS "observedAt",
        pricing.provider::text AS "pricingProvider",
        analytics.provider_key AS "historyProvider"
      FROM source_rollup sr
      JOIN catalog_products cp ON cp.id = sr.product_id
      LEFT JOIN LATERAL (
        SELECT haa.*
        FROM history_analytics_assessments haa
        WHERE haa.organization_id = ${organizationId}
          AND haa.catalog_product_id = cp.id
        ORDER BY haa.calculated_at DESC
        LIMIT 1
      ) analytics ON true
      LEFT JOIN LATERAL (
        SELECT po.*
        FROM listing_candidates lc
        JOIN enrichment_items ei ON ei.supplier_row_id = lc.supplier_row_id
        JOIN provider_observations po ON po.enrichment_item_id = ei.id
        WHERE lc.organization_id = ${organizationId}
          AND lc.catalog_product_id = cp.id
          AND po.metric_type = 'PRICING'
          AND po.observation_status = 'SUCCESS'
        ORDER BY po.observed_at DESC
        LIMIT 1
      ) pricing ON true
      LEFT JOIN LATERAL (
        SELECT hmp.integer_value
        FROM historical_metric_series hms
        JOIN historical_metric_points hmp ON hmp.series_id = hms.id
        WHERE hms.organization_id = ${organizationId}
          AND hms.catalog_product_id = cp.id
          AND hms.metric_key = 'REVIEW_COUNT'
        ORDER BY hmp.metric_at DESC
        LIMIT 1
      ) review_count ON true
      LEFT JOIN LATERAL (
        SELECT hmp.decimal_value
        FROM historical_metric_series hms
        JOIN historical_metric_points hmp ON hmp.series_id = hms.id
        WHERE hms.organization_id = ${organizationId}
          AND hms.catalog_product_id = cp.id
          AND hms.metric_key = 'RATING'
        ORDER BY hmp.metric_at DESC
        LIMIT 1
      ) rating ON true
      LEFT JOIN LATERAL (
        SELECT hmp.integer_value
        FROM historical_metric_series hms
        JOIN historical_metric_points hmp ON hmp.series_id = hms.id
        WHERE hms.organization_id = ${organizationId}
          AND hms.catalog_product_id = cp.id
          AND hms.metric_key = 'SALES_RANK'
        ORDER BY hmp.metric_at DESC
        LIMIT 1
      ) rank_point ON true
    )`;
}

function filterQuery(filters: ProductExplorerFilters): Prisma.Sql {
  const where: Prisma.Sql[] = [];
  if (filters.marketplaceId)
    where.push(Prisma.sql`"marketplaceId" = ${filters.marketplaceId}`);
  if (filters.search) {
    const pattern = `%${filters.search.trim()}%`;
    where.push(
      Prisma.sql`(title ILIKE ${pattern} OR asin ILIKE ${pattern} OR brand ILIKE ${pattern})`,
    );
  }
  if (filters.brand)
    where.push(Prisma.sql`brand ILIKE ${`%${filters.brand.trim()}%`}`);
  if (filters.category)
    where.push(Prisma.sql`category ILIKE ${`%${filters.category.trim()}%`}`);
  if (filters.minPrice)
    where.push(Prisma.sql`price >= ${filters.minPrice}::numeric`);
  if (filters.maxPrice)
    where.push(Prisma.sql`price <= ${filters.maxPrice}::numeric`);
  if (filters.maxReviewCount !== undefined)
    where.push(Prisma.sql`"reviewCount" <= ${filters.maxReviewCount}`);
  if (filters.maxPriceVolatilityPercent)
    where.push(
      Prisma.sql`"priceVolatilityPercent" <= ${filters.maxPriceVolatilityPercent}::numeric`,
    );
  if (filters.dataCompleteness)
    where.push(Prisma.sql`"historyStatus" = ${filters.dataCompleteness}`);
  return where.length
    ? Prisma.sql`WHERE ${Prisma.join(where, " AND ")}`
    : Prisma.empty;
}

function project(row: RawExplorerRow) {
  const providerKey = (provider: string | null) =>
    provider === "AMAZON_SP_API"
      ? "amazon-sp-api"
      : provider === "MOCK_AMAZON"
        ? "mock-amazon"
        : provider === "MOCK_HISTORY"
          ? "recorded-history"
          : provider;
  return {
    id: row.id,
    asin: row.asin,
    title: row.title,
    brand: row.brand,
    marketplaceId: row.marketplaceId,
    category: row.category,
    catalogProviderKey: providerKey(row.catalogProvider),
    sources: row.sources.split(","),
    price: text(row.price),
    currency: row.currency,
    rating: text(row.rating),
    reviewCount: text(row.reviewCount),
    salesRank: text(row.salesRank === null ? null : BigInt(row.salesRank)),
    offerCount: row.offerCount,
    fbaOfferCount: row.fbaOfferCount,
    fbmOfferCount: row.fbmOfferCount,
    amazonRetailPresence: row.amazonRetailPresence,
    priceVolatilityPercent: text(row.priceVolatilityPercent),
    reviewGrowth: text(row.reviewGrowth),
    listingAgeDays: text(row.listingAgeDays),
    seasonalityStatus: row.seasonalityStatus,
    historyStatus: row.historyStatus,
    historyCoveragePercent: text(row.historyCoveragePercent),
    freshnessState: row.freshnessState,
    observedAt: row.observedAt?.toISOString() ?? null,
    pricingProviderKey: providerKey(row.pricingProvider),
    historyProviderKey: row.historyProvider,
  };
}

export async function listProductExplorer(input: {
  organizationId: string;
  offset: number;
  limit: number;
  filters: ProductExplorerFilters;
}) {
  const base = baseQuery(input.organizationId);
  const where = filterQuery(input.filters);
  const limit = Math.min(Math.max(input.limit, 1), PRODUCT_EXPLORER_PAGE_LIMIT);
  const [rows, count] = await withInteractiveResearchQuery(
    async (transaction) =>
      Promise.all([
        transaction.$queryRaw<RawExplorerRow[]>(Prisma.sql`${base}
          SELECT * FROM explorer_data ${where}
          ORDER BY title ASC, id ASC
          LIMIT ${limit} OFFSET ${input.offset}`),
        transaction.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`${base}
          SELECT count(*)::bigint AS count FROM explorer_data ${where}`),
      ]),
  );
  return { total: Number(count[0]?.count ?? 0), rows: rows.map(project) };
}

export async function listProductExplorerViews(organizationId: string) {
  return db.analysisView.findMany({
    where: {
      organizationId,
      scanJobId: null,
      schemaVersion: PRODUCT_EXPLORER_VIEW_SCHEMA_VERSION,
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function saveProductExplorerView(input: {
  organizationId: string;
  name: string;
  queryState: Prisma.InputJsonValue;
  isDefault?: boolean;
}) {
  const name = input.name.trim();
  if (!name) throw new Error("PRODUCT_EXPLORER_VIEW_NAME_REQUIRED");
  return db.$transaction(async (transaction) => {
    if (input.isDefault)
      await transaction.analysisView.updateMany({
        where: {
          organizationId: input.organizationId,
          scanJobId: null,
          schemaVersion: PRODUCT_EXPLORER_VIEW_SCHEMA_VERSION,
        },
        data: { isDefault: false },
      });
    const existing = await transaction.analysisView.findFirst({
      where: { organizationId: input.organizationId, scanJobId: null, name },
      select: { id: true },
    });
    const data = {
      schemaVersion: PRODUCT_EXPLORER_VIEW_SCHEMA_VERSION,
      queryState: input.queryState,
      isDefault: input.isDefault ?? false,
    };
    return existing
      ? transaction.analysisView.update({ where: { id: existing.id }, data })
      : transaction.analysisView.create({
          data: {
            organizationId: input.organizationId,
            scanJobId: null,
            name,
            ...data,
          },
        });
  });
}
