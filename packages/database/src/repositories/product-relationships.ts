import { db } from "../client.js";

export const RELATIONSHIP_SEED_WINDOW = 500;
export const RELATIONSHIP_OBSERVATION_WINDOW = 10_000;

export type DerivedProductRelationship = {
  catalogProductId: string;
  asin: string | null;
  title: string;
  relationshipType: "SHARED_KEYWORD" | "SHARED_MARKET";
  source: "DERIVED";
  strength: number;
  confidence: "LOW" | "MEDIUM";
  observedAt: Date;
};

/** Builds a bounded neighborhood from tenant-owned evidence only. It makes no
 * Amazon behavioral inference. */
export async function derivedProductRelationships(input: {
  organizationId: string;
  catalogProductId: string;
  types?: Array<"SHARED_KEYWORD" | "SHARED_MARKET"> | undefined;
}): Promise<DerivedProductRelationship[]> {
  const enabled = new Set(input.types ?? ["SHARED_KEYWORD", "SHARED_MARKET"]);
  const relationships: DerivedProductRelationship[] = [];
  if (enabled.has("SHARED_KEYWORD")) {
    const seed = await db.productKeywordObservation.findMany({
      where: {
        organizationId: input.organizationId,
        catalogProductId: input.catalogProductId,
      },
      select: { keywordId: true },
      distinct: ["keywordId"],
      take: RELATIONSHIP_SEED_WINDOW,
    });
    if (seed.length) {
      const neighbors = await db.productKeywordObservation.findMany({
        where: {
          organizationId: input.organizationId,
          keywordId: { in: seed.map((item) => item.keywordId) },
          NOT: { catalogProductId: input.catalogProductId },
        },
        include: {
          catalogProduct: { select: { asin: true, title: true } },
          observation: true,
        },
        orderBy: [{ observation: { observedAt: "desc" } }, { id: "desc" }],
        take: RELATIONSHIP_OBSERVATION_WINDOW,
      });
      const grouped = new Map<string, typeof neighbors>();
      for (const row of neighbors)
        grouped.set(row.catalogProductId, [
          ...(grouped.get(row.catalogProductId) ?? []),
          row,
        ]);
      for (const [catalogProductId, rows] of grouped) {
        const uniqueKeywords = new Set(rows.map((row) => row.keywordId));
        relationships.push({
          catalogProductId,
          asin: rows[0]!.catalogProduct.asin,
          title: rows[0]!.catalogProduct.title,
          relationshipType: "SHARED_KEYWORD",
          source: "DERIVED",
          strength: uniqueKeywords.size,
          confidence: uniqueKeywords.size > 1 ? "MEDIUM" : "LOW",
          observedAt: new Date(
            Math.max(
              ...rows.map((row) => row.observation.observedAt.getTime()),
            ),
          ),
        });
      }
    }
  }
  if (enabled.has("SHARED_MARKET")) {
    const membership = await db.marketMember.findMany({
      where: {
        organizationId: input.organizationId,
        catalogProductId: input.catalogProductId,
        leftAt: null,
      },
      select: { marketDefinitionId: true },
      distinct: ["marketDefinitionId"],
      take: RELATIONSHIP_SEED_WINDOW,
    });
    if (membership.length) {
      const neighbors = await db.marketMember.findMany({
        where: {
          organizationId: input.organizationId,
          marketDefinitionId: {
            in: membership.map((item) => item.marketDefinitionId),
          },
          catalogProductId: { not: input.catalogProductId },
          leftAt: null,
        },
        include: { catalogProduct: { select: { asin: true, title: true } } },
        orderBy: [{ joinedAt: "desc" }, { id: "desc" }],
        take: RELATIONSHIP_OBSERVATION_WINDOW,
      });
      const grouped = new Map<string, typeof neighbors>();
      for (const row of neighbors)
        grouped.set(row.catalogProductId, [
          ...(grouped.get(row.catalogProductId) ?? []),
          row,
        ]);
      for (const [catalogProductId, rows] of grouped) {
        relationships.push({
          catalogProductId,
          asin: rows[0]!.catalogProduct.asin,
          title: rows[0]!.catalogProduct.title,
          relationshipType: "SHARED_MARKET",
          source: "DERIVED",
          strength: new Set(rows.map((row) => row.marketDefinitionId)).size,
          confidence: rows.length > 1 ? "MEDIUM" : "LOW",
          observedAt: new Date(
            Math.max(...rows.map((row) => row.joinedAt.getTime())),
          ),
        });
      }
    }
  }
  return relationships.sort((a, b) => b.strength - a.strength).slice(0, 100);
}
