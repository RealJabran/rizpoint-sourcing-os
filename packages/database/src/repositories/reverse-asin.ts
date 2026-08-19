import { db } from "../client.js";

export const REVERSE_ASIN_OBSERVATION_WINDOW = 10_000;
export const REVERSE_ASIN_KEYWORD_WINDOW = 1_000;

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
  const latest = new Map<string, (typeof observations)[number]>();
  for (const item of observations) {
    const key = `${item.catalogProductId}:${item.keywordId}`;
    if (!latest.has(key)) latest.set(key, item);
  }
  const groups = new Map<string, typeof observations>();
  for (const item of latest.values())
    groups.set(item.keywordId, [...(groups.get(item.keywordId) ?? []), item]);
  return [...groups.values()]
    .map((items) => {
      const ranks = new Map(
        items.map((item) => [
          item.catalogProduct.asin ?? item.catalogProductId,
          {
            organicRank: item.organicRank,
            sponsoredRank: item.sponsoredRank,
            observedAt: item.observation.observedAt.toISOString(),
          },
        ]),
      );
      const keyword = items[0]!.keyword;
      const matched = asins.filter(
        (asin) =>
          ranks.get(asin)?.organicRank !== null &&
          ranks.get(asin)?.organicRank !== undefined,
      );
      const mine = input.mineAsin ? ranks.get(input.mineAsin) : undefined;
      const competitorRanks = [...ranks.entries()]
        .filter(([asin]) => asin !== input.mineAsin)
        .flatMap(([, value]) =>
          value.organicRank === null ? [] : [value.organicRank],
        );
      const averageRank = competitorRanks.length
        ? (
            competitorRanks.reduce((a, b) => a + b, 0) / competitorRanks.length
          ).toFixed(2)
        : null;
      const gap = input.mineAsin
        ? matched.filter((asin) => asin !== input.mineAsin).length ===
            asins.filter((asin) => asin !== input.mineAsin).length &&
          !mine?.organicRank
        : false;
      return {
        keywordId: keyword.id,
        phrase: keyword.phrase,
        provider: items[0]!.observation.providerKey,
        observedAt: items.map((item) =>
          item.observation.observedAt.toISOString(),
        ),
        matrix: Object.fromEntries(ranks),
        rankingAsinCount: matched.length,
        averageOrganicRank: averageRank,
        competitorGap: gap,
        searchVolume: null,
      };
    })
    .sort((a, b) => b.rankingAsinCount - a.rankingAsinCount)
    .slice(0, REVERSE_ASIN_KEYWORD_WINDOW);
}
