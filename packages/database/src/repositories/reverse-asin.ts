import { db } from "../client.js";

export const REVERSE_ASIN_OBSERVATION_WINDOW = 10_000;
export const REVERSE_ASIN_KEYWORD_WINDOW = 1_000;
export const REVERSE_ASIN_GAP_VERSION = "reverse-asin-gap/v1";

export type ReverseAsinGapObservation = {
  observationId: string;
  productId: string;
  asin: string;
  keywordId: string;
  phrase: string;
  provider: string;
  observedAt: string;
  organicRank: number | null;
  sponsoredRank: number | null;
};

/** Latest-observation-wins gap math. Missing ranks remain absent and never
 * become zero or an inferred search result position. */
export function calculateReverseAsinKeywordGap(input: {
  asins: readonly string[];
  observations: readonly ReverseAsinGapObservation[];
  mineAsin?: string | undefined;
}) {
  const asins = [...new Set(input.asins)].slice(0, 10);
  if (!asins.length) return [];
  const asinSet = new Set(asins);
  const ordered = [...input.observations]
    .filter((item) => asinSet.has(item.asin))
    .sort(
      (left, right) =>
        Date.parse(right.observedAt) - Date.parse(left.observedAt) ||
        right.observationId.localeCompare(left.observationId),
    )
    .slice(0, REVERSE_ASIN_OBSERVATION_WINDOW);
  const latest = new Map<string, ReverseAsinGapObservation>();
  for (const item of ordered) {
    const key = `${item.productId}:${item.keywordId}`;
    if (!latest.has(key)) latest.set(key, item);
  }
  const groups = new Map<string, ReverseAsinGapObservation[]>();
  for (const item of latest.values())
    groups.set(item.keywordId, [...(groups.get(item.keywordId) ?? []), item]);
  return [...groups.values()]
    .map((items) => {
      const ranks = new Map(
        items.map((item) => [
          item.asin,
          {
            organicRank: item.organicRank,
            sponsoredRank: item.sponsoredRank,
            observedAt: item.observedAt,
          },
        ]),
      );
      const matched = asins.filter(
        (asin) => ranks.get(asin)?.organicRank != null,
      );
      const mine = input.mineAsin ? ranks.get(input.mineAsin) : undefined;
      const competitors = asins.filter((asin) => asin !== input.mineAsin);
      const competitorRanks = competitors.flatMap((asin) => {
        const value = ranks.get(asin)?.organicRank;
        return value == null ? [] : [value];
      });
      const averageRank = competitorRanks.length
        ? (
            competitorRanks.reduce((total, rank) => total + rank, 0) /
            competitorRanks.length
          ).toFixed(2)
        : null;
      const allCompetitorsRank =
        competitors.length > 0 && competitorRanks.length === competitors.length;
      const mineRanks = mine?.organicRank != null;
      const noCompetitorRanks = competitorRanks.length === 0;
      return {
        calculationVersion: REVERSE_ASIN_GAP_VERSION,
        keywordId: items[0]!.keywordId,
        phrase: items[0]!.phrase,
        provider: items[0]!.provider,
        observedAt: items.map((item) => item.observedAt).sort(),
        matrix: Object.fromEntries(ranks),
        rankingAsinCount: matched.length,
        averageOrganicRank: averageRank,
        competitorGap: Boolean(
          input.mineAsin && allCompetitorsRank && !mineRanks,
        ),
        mineOnly: Boolean(input.mineAsin && mineRanks && noCompetitorRanks),
        searchVolume: null,
      };
    })
    .sort(
      (left, right) =>
        right.rankingAsinCount - left.rankingAsinCount ||
        left.phrase.localeCompare(right.phrase),
    )
    .slice(0, REVERSE_ASIN_KEYWORD_WINDOW);
}

export async function reverseAsinKeywordGap(input: {
  organizationId: string;
  asins: string[];
  mineAsin?: string | undefined;
}) {
  const asins = [...new Set(input.asins)].slice(0, 10);
  if (!asins.length) return [];
  const observations = await db.productKeywordObservation.findMany({
    where: {
      organizationId: input.organizationId,
      catalogProduct: { asin: { in: asins } },
    },
    include: {
      catalogProduct: { select: { asin: true } },
      keyword: true,
      observation: true,
    },
    orderBy: [{ observation: { observedAt: "desc" } }, { id: "desc" }],
    take: REVERSE_ASIN_OBSERVATION_WINDOW,
  });
  return calculateReverseAsinKeywordGap({
    asins,
    ...(input.mineAsin ? { mineAsin: input.mineAsin } : {}),
    observations: observations.flatMap((item) =>
      item.catalogProduct.asin
        ? [
            {
              observationId: item.id,
              productId: item.catalogProductId,
              asin: item.catalogProduct.asin,
              keywordId: item.keywordId,
              phrase: item.keyword.phrase,
              provider: item.observation.providerKey,
              observedAt: item.observation.observedAt.toISOString(),
              organicRank: item.organicRank,
              sponsoredRank: item.sponsoredRank,
            },
          ]
        : [],
    ),
  });
}
