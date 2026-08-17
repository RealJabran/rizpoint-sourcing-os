import { db } from "../client.js";

export type SellerIntelligenceRow = {
  sellerReference: string;
  displayName: string | null;
  knownProductCount: bigint | null;
  amazonRetailPresence: "PRESENT" | "ABSENT" | "UNKNOWN";
  providerKey: string;
  observedAt: Date;
  completeness: "COMPLETE" | "PARTIAL" | "UNKNOWN";
  metrics: unknown;
};

/** Latest authorized observation per seller. This intentionally queries only
 * tenant-scoped provider evidence; it does not discover storefronts itself. */
export async function listSellerIntelligence(input: {
  organizationId: string;
  query?: string | undefined;
  limit?: number | undefined;
}): Promise<SellerIntelligenceRow[]> {
  const rows = await db.sellerObservation.findMany({
    where: {
      organizationId: input.organizationId,
      ...(input.query
        ? {
            OR: [
              {
                sellerReference: { contains: input.query, mode: "insensitive" },
              },
              { displayName: { contains: input.query, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: { observation: true },
    orderBy: { observation: { observedAt: "desc" } },
    take: Math.min(input.limit ?? 100, 100),
  });
  const latest = new Map<string, SellerIntelligenceRow>();
  for (const row of rows) {
    if (!latest.has(row.sellerReference)) {
      latest.set(row.sellerReference, {
        sellerReference: row.sellerReference,
        displayName: row.displayName,
        knownProductCount: row.productCount,
        amazonRetailPresence: row.amazonRetailPresence,
        providerKey: row.observation.providerKey,
        observedAt: row.observation.observedAt,
        completeness: row.observation.completeness,
        metrics: row.metrics,
      });
    }
  }
  return [...latest.values()];
}
