import { createHash } from "node:crypto";
import { Prisma } from "../generated/prisma/client.js";
import { db } from "../client.js";
import {
  calculateNicheOpportunityScore,
  DEFAULT_NICHE_SCORE_THRESHOLDS,
  NICHE_OPPORTUNITY_SCORE_VERSION,
  type NicheScoreInputRow,
  type NicheScoreThresholds,
} from "../opportunity-scoring.js";

export const NICHE_PAGE_LIMIT = 100;
export const NICHE_PRODUCT_WINDOW_LIMIT = 1000;
export const NICHE_SOURCE_TYPES = [
  "SEED_KEYWORD",
  "KEYWORD_CLUSTER",
  "CATEGORY",
  "MANUAL_COMPETITORS",
  "MARKET_DEFINITION",
] as const;
export type NicheSourceType = (typeof NICHE_SOURCE_TYPES)[number];

type NicheDefinition = {
  kind: "NICHE";
  sourceType: NicheSourceType;
  seedKeyword?: string;
  keywords?: string[];
  categoryReference?: string;
  competitorProductIds?: string[];
  sourceMarketDefinitionId?: string;
};

type RawNicheRow = {
  productId: string;
  brand: string | null;
  price: { toString(): string } | null;
  reviewCount: bigint | null;
  priceVolatilityPercent: { toString(): string } | null;
  listingAgeDays: { toString(): string } | null;
  amazonRetailPresence: string | null;
  historyStatus: string | null;
  historyAssessmentId: string | null;
  observedAt: Date | null;
};

function text(value: { toString(): string } | bigint | null) {
  return value === null ? null : value.toString();
}

function definitionFrom(value: Prisma.JsonValue): NicheDefinition | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (
    source.kind !== "NICHE" ||
    !NICHE_SOURCE_TYPES.includes(source.sourceType as NicheSourceType)
  )
    return null;
  return source as unknown as NicheDefinition;
}

function fingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function universeQuery(organizationId: string) {
  return Prisma.sql`
    SELECT DISTINCT product_id FROM (
      SELECT catalog_product_id AS product_id FROM listing_candidates WHERE organization_id = ${organizationId}
      UNION SELECT catalog_product_id FROM research_project_items WHERE organization_id = ${organizationId} AND kind = 'PRODUCT' AND catalog_product_id IS NOT NULL
      UNION SELECT catalog_product_id FROM product_watches WHERE organization_id = ${organizationId} AND status = 'ACTIVE'
      UNION SELECT catalog_product_id FROM market_members WHERE organization_id = ${organizationId} AND left_at IS NULL
      UNION SELECT catalog_product_id FROM history_refresh_items WHERE organization_id = ${organizationId} AND catalog_product_id IS NOT NULL
    ) scoped_products`;
}

async function ownedIds(organizationId: string, requested: string[]) {
  const normalized = [
    ...new Set(requested.filter((value) => value.trim())),
  ].slice(0, NICHE_PRODUCT_WINDOW_LIMIT);
  if (!normalized.length) return [];
  const rows = await db.$queryRaw<Array<{ product_id: string }>>(
    Prisma.sql`WITH allowed AS (${universeQuery(organizationId)}) SELECT product_id FROM allowed WHERE product_id IN (${Prisma.join(normalized)})`,
  );
  return rows.map((row) => row.product_id);
}

async function nicheProductIds(input: {
  organizationId: string;
  marketplaceId: string;
  definition: NicheDefinition;
}) {
  const { organizationId, marketplaceId, definition } = input;
  if (definition.sourceType === "MANUAL_COMPETITORS")
    return ownedIds(organizationId, definition.competitorProductIds ?? []);
  if (definition.sourceType === "MARKET_DEFINITION") {
    if (!definition.sourceMarketDefinitionId) return [];
    const members = await db.marketMember.findMany({
      where: {
        organizationId,
        marketDefinitionId: definition.sourceMarketDefinitionId,
        leftAt: null,
      },
      select: { catalogProductId: true },
      take: NICHE_PRODUCT_WINDOW_LIMIT,
    });
    return members.map((member) => member.catalogProductId);
  }
  if (definition.sourceType === "CATEGORY") {
    if (!definition.categoryReference) return [];
    const rows = await db.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`WITH allowed AS (${universeQuery(organizationId)})
        SELECT cp.id FROM allowed JOIN catalog_products cp ON cp.id = allowed.product_id
        WHERE cp.marketplace_id = ${marketplaceId}
          AND COALESCE(NULLIF(cp.identity_projection -> 'productTypes' ->> 0, ''), 'Uncategorized (provider did not supply a category)') = ${definition.categoryReference}
        ORDER BY cp.title ASC, cp.id ASC LIMIT ${NICHE_PRODUCT_WINDOW_LIMIT}`,
    );
    return rows.map((row) => row.id);
  }
  const phrases =
    definition.sourceType === "SEED_KEYWORD"
      ? [definition.seedKeyword ?? ""]
      : (definition.keywords ?? []);
  const normalized = phrases
    .map((value) => value.trim().toLocaleLowerCase("en-US"))
    .filter(Boolean);
  if (!normalized.length) return [];
  const rows = await db.productKeywordObservation.findMany({
    where: {
      organizationId,
      keyword: { marketplaceId, normalizedPhrase: { in: normalized } },
    },
    select: { catalogProductId: true },
    distinct: ["catalogProductId"],
    take: NICHE_PRODUCT_WINDOW_LIMIT,
  });
  return rows.map((row) => row.catalogProductId);
}

async function productRows(organizationId: string, productIds: string[]) {
  if (!productIds.length) return [] as RawNicheRow[];
  return db.$queryRaw<RawNicheRow[]>(Prisma.sql`
    SELECT cp.id AS "productId", cp.brand, pricing.featured_price AS price,
      reviews.integer_value AS "reviewCount",
      (analytics.metrics #>> '{price,90,volatilityPercent}')::numeric AS "priceVolatilityPercent",
      (analytics.metrics ->> 'estimatedListingAgeDays')::numeric AS "listingAgeDays",
      pricing.amazon_retail_presence::text AS "amazonRetailPresence",
      analytics.status::text AS "historyStatus", analytics.id AS "historyAssessmentId",
      pricing.observed_at AS "observedAt"
    FROM catalog_products cp
    LEFT JOIN LATERAL (SELECT * FROM history_analytics_assessments WHERE organization_id = ${organizationId} AND catalog_product_id = cp.id ORDER BY calculated_at DESC LIMIT 1) analytics ON true
    LEFT JOIN LATERAL (SELECT po.* FROM listing_candidates lc JOIN enrichment_items ei ON ei.supplier_row_id = lc.supplier_row_id JOIN provider_observations po ON po.enrichment_item_id = ei.id WHERE lc.organization_id = ${organizationId} AND lc.catalog_product_id = cp.id AND po.metric_type = 'PRICING' AND po.observation_status = 'SUCCESS' ORDER BY po.observed_at DESC LIMIT 1) pricing ON true
    LEFT JOIN LATERAL (SELECT hmp.integer_value FROM historical_metric_series hms JOIN historical_metric_points hmp ON hmp.series_id = hms.id WHERE hms.organization_id = ${organizationId} AND hms.catalog_product_id = cp.id AND hms.metric_key = 'REVIEW_COUNT' ORDER BY hmp.metric_at DESC LIMIT 1) reviews ON true
    WHERE cp.id IN (${Prisma.join(productIds)})
    ORDER BY cp.title ASC, cp.id ASC
  `);
}

function scoreRows(rows: RawNicheRow[]): NicheScoreInputRow[] {
  return rows.map((row) => ({
    productId: row.productId,
    brand: row.brand,
    price: text(row.price),
    reviewCount: text(row.reviewCount),
    priceVolatilityPercent: text(row.priceVolatilityPercent),
    listingAgeDays: text(row.listingAgeDays),
    amazonRetailPresence: row.amazonRetailPresence,
    historyStatus: row.historyStatus,
    historyAssessmentId: row.historyAssessmentId,
    observedAt: row.observedAt?.toISOString() ?? null,
  }));
}

export async function createNicheDefinition(input: {
  organizationId: string;
  projectId?: string | undefined;
  marketplaceId: string;
  name: string;
  definition: NicheDefinition;
}) {
  const name = input.name.trim();
  if (!name) throw new Error("NICHE_NAME_REQUIRED");
  const existing = await db.marketDefinition.findFirst({
    where: {
      organizationId: input.organizationId,
      marketplaceId: input.marketplaceId,
      name,
      version: 1,
    },
  });
  if (existing) return existing;
  if (input.projectId) {
    const project = await db.researchProject.findFirst({
      where: {
        id: input.projectId,
        organizationId: input.organizationId,
        marketplaceId: input.marketplaceId,
      },
      select: { id: true },
    });
    if (!project) throw new Error("RESEARCH_PROJECT_NOT_FOUND");
  }
  return db.marketDefinition.create({
    data: {
      organizationId: input.organizationId,
      projectId: input.projectId ?? null,
      marketplaceId: input.marketplaceId,
      name,
      version: 1,
      membershipMode:
        input.definition.sourceType === "MANUAL_COMPETITORS"
          ? "FROZEN"
          : "DYNAMIC",
      definition: input.definition,
    },
  });
}

export async function recalculateNicheAssessment(input: {
  organizationId: string;
  nicheId: string;
  thresholds?: NicheScoreThresholds | undefined;
}) {
  const niche = await db.marketDefinition.findFirst({
    where: { id: input.nicheId, organizationId: input.organizationId },
  });
  if (!niche) throw new Error("NICHE_NOT_FOUND");
  const definition = definitionFrom(niche.definition);
  if (!definition) throw new Error("NICHE_DEFINITION_INVALID");
  const thresholds = input.thresholds ?? DEFAULT_NICHE_SCORE_THRESHOLDS;
  const ids = await nicheProductIds({
    organizationId: input.organizationId,
    marketplaceId: niche.marketplaceId,
    definition,
  });
  const rows = await productRows(input.organizationId, ids);
  const scored = calculateNicheOpportunityScore(scoreRows(rows), thresholds);
  const inputEvidenceReferences = rows.map((row) => ({
    productId: row.productId,
    historyAssessmentId: row.historyAssessmentId,
    observedAt: row.observedAt?.toISOString() ?? null,
  }));
  const inputFingerprint = fingerprint({
    nicheId: niche.id,
    definition,
    thresholds,
    inputEvidenceReferences,
  });
  return db.nicheAssessment.upsert({
    where: {
      organizationId_marketDefinitionId_calculationVersion_inputFingerprint: {
        organizationId: input.organizationId,
        marketDefinitionId: niche.id,
        calculationVersion: NICHE_OPPORTUNITY_SCORE_VERSION,
        inputFingerprint,
      },
    },
    create: {
      organizationId: input.organizationId,
      marketDefinitionId: niche.id,
      marketplaceId: niche.marketplaceId,
      status: scored.status,
      score: scored.score,
      confidencePercent: scored.confidencePercent,
      calculationVersion: NICHE_OPPORTUNITY_SCORE_VERSION,
      inputFingerprint,
      thresholdConfiguration: thresholds,
      components: { components: scored.components, metrics: scored.metrics },
      inputEvidenceReferences,
      calculatedAt: new Date(),
    },
    update: {},
  });
}

export async function listNiches(input: {
  organizationId: string;
  offset: number;
  limit: number;
  minScore?: string | undefined;
  minConfidence?: string | undefined;
}) {
  const all = await db.marketDefinition.findMany({
    where: { organizationId: input.organizationId },
    orderBy: { updatedAt: "desc" },
    take: 500,
  });
  const niches = all.filter((niche) => definitionFrom(niche.definition));
  const assessments = await db.nicheAssessment.findMany({
    where: {
      organizationId: input.organizationId,
      marketDefinitionId: { in: niches.map((niche) => niche.id) },
    },
    orderBy: { calculatedAt: "desc" },
  });
  const latest = new Map<string, (typeof assessments)[number]>();
  for (const assessment of assessments)
    if (!latest.has(assessment.marketDefinitionId))
      latest.set(assessment.marketDefinitionId, assessment);
  const filtered = niches.filter((niche) => {
    const assessment = latest.get(niche.id);
    if (
      input.minScore &&
      (!assessment?.score || assessment.score.lt(input.minScore))
    )
      return false;
    return !(
      input.minConfidence &&
      (!assessment?.confidencePercent ||
        assessment.confidencePercent.lt(input.minConfidence))
    );
  });
  const limit = Math.min(Math.max(input.limit, 1), NICHE_PAGE_LIMIT);
  return {
    total: filtered.length,
    rows: filtered.slice(input.offset, input.offset + limit).map((niche) => {
      const assessment = latest.get(niche.id);
      const definition = definitionFrom(niche.definition)!;
      return {
        id: niche.id,
        name: niche.name,
        marketplaceId: niche.marketplaceId,
        sourceType: definition.sourceType,
        score: assessment?.score?.toString() ?? null,
        confidencePercent: assessment?.confidencePercent?.toString() ?? null,
        status: assessment?.status ?? "NOT_CALCULATED",
        calculatedAt: assessment?.calculatedAt.toISOString() ?? null,
      };
    }),
  };
}

export async function getNicheDetail(input: {
  organizationId: string;
  nicheId: string;
}) {
  const niche = await db.marketDefinition.findFirst({
    where: { id: input.nicheId, organizationId: input.organizationId },
  });
  if (!niche || !definitionFrom(niche.definition)) return null;
  const assessment = await db.nicheAssessment.findFirst({
    where: {
      organizationId: input.organizationId,
      marketDefinitionId: niche.id,
    },
    orderBy: { calculatedAt: "desc" },
  });
  return {
    id: niche.id,
    name: niche.name,
    marketplaceId: niche.marketplaceId,
    definition: definitionFrom(niche.definition),
    assessment: assessment
      ? {
          status: assessment.status,
          score: assessment.score?.toString() ?? null,
          confidencePercent: assessment.confidencePercent?.toString() ?? null,
          calculationVersion: assessment.calculationVersion,
          thresholdConfiguration: assessment.thresholdConfiguration,
          components: assessment.components,
          inputEvidenceReferences: assessment.inputEvidenceReferences,
          calculatedAt: assessment.calculatedAt.toISOString(),
        }
      : null,
  };
}
