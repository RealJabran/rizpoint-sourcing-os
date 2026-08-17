import { db } from "../client.js";

export async function listKeywordExplorer(input: {
  organizationId: string;
  marketplaceId?: string | undefined;
  search?: string | undefined;
  include?: string | undefined;
  exclude?: string | undefined;
  offset: number;
  limit: number;
}) {
  const rows = await db.keyword.findMany({
    where: {
      organizationId: input.organizationId,
      ...(input.marketplaceId ? { marketplaceId: input.marketplaceId } : {}),
      ...(input.search
        ? {
            OR: [
              { phrase: { contains: input.search, mode: "insensitive" } },
              {
                normalizedPhrase: {
                  contains: input.search.toLocaleLowerCase("en-US"),
                  mode: "insensitive",
                },
              },
            ],
          }
        : {}),
    },
    include: {
      keywordObservations: {
        include: { observation: true },
        orderBy: { observation: { observedAt: "desc" } },
        take: 1,
      },
    },
    orderBy: { updatedAt: "desc" },
    take: Math.min(input.limit, 100),
    skip: input.offset,
  });
  const filtered = rows.filter(
    (row) =>
      (!input.include ||
        row.normalizedPhrase.includes(
          input.include.toLocaleLowerCase("en-US"),
        )) &&
      (!input.exclude ||
        !row.normalizedPhrase.includes(
          input.exclude.toLocaleLowerCase("en-US"),
        )),
  );
  const total = await db.keyword.count({
    where: {
      organizationId: input.organizationId,
      ...(input.marketplaceId ? { marketplaceId: input.marketplaceId } : {}),
    },
  });
  return {
    total,
    rows: filtered.map((row) => {
      const observation = row.keywordObservations[0];
      return {
        id: row.id,
        phrase: row.phrase,
        normalizedPhrase: row.normalizedPhrase,
        marketplaceId: row.marketplaceId,
        searchVolume: observation?.searchVolume?.toString() ?? null,
        competingProductCount:
          observation?.competingProductCount?.toString() ?? null,
        suggestedBid: observation?.suggestedBid?.toString() ?? null,
        provider: observation?.observation.providerKey ?? null,
        observedAt: observation?.observation.observedAt.toISOString() ?? null,
        completeness: observation?.observation.completeness ?? "UNKNOWN",
        metrics: observation?.metrics ?? null,
      };
    }),
  };
}
