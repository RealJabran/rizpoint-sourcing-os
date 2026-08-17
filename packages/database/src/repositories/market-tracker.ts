import { db } from "../client.js";
export async function listMarketTracker(organizationId: string) {
  const markets = await db.marketDefinition.findMany({
    where: { organizationId },
    include: {
      members: { where: { leftAt: null }, include: { catalogProduct: true } },
      marketObservations: {
        include: { observation: true },
        orderBy: { observation: { observedAt: "desc" } },
        take: 1,
      },
    },
    orderBy: { updatedAt: "desc" },
  });
  return markets.map((market) => ({
    id: market.id,
    name: market.name,
    marketplaceId: market.marketplaceId,
    membershipMode: market.membershipMode,
    memberCount: market.members.length,
    latestObservedAt:
      market.marketObservations[0]?.observation.observedAt.toISOString() ??
      null,
    estimatedRevenue:
      market.marketObservations[0]?.estimatedRevenue?.toString() ?? null,
    coverage:
      market.marketObservations[0]?.observation.completeness ?? "UNKNOWN",
  }));
}
