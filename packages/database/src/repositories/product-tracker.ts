import { db } from "../client.js";

export const PRODUCT_TRACKER_PAGE_LIMIT = 100;

export async function listProductTracker(input: {
  organizationId: string;
  marketplaceId?: string;
  offset?: number;
  limit?: number;
}) {
  const limit = Math.min(
    PRODUCT_TRACKER_PAGE_LIMIT,
    Math.max(1, input.limit ?? 50),
  );
  const offset = Math.max(0, input.offset ?? 0);
  const where = {
    organizationId: input.organizationId,
    ...(input.marketplaceId ? { marketplaceId: input.marketplaceId } : {}),
  };
  const [total, watches] = await db.$transaction([
    db.productWatch.count({ where }),
    db.productWatch.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      skip: offset,
      take: limit,
      include: {
        project: { select: { id: true, name: true } },
        catalogProduct: {
          select: {
            id: true,
            asin: true,
            title: true,
            brand: true,
            provider: true,
            observedAt: true,
            freshnessState: true,
            salesEstimates: {
              where: { organizationId: input.organizationId },
              orderBy: { observedAt: "desc" },
              take: 25,
              select: {
                marketplaceId: true,
                monthlyUnitsLow: true,
                monthlyUnitsHigh: true,
                confidencePercent: true,
                source: true,
                providerKey: true,
                modelVersion: true,
                observedAt: true,
              },
            },
            historyAnalyticsAssessments: {
              where: { organizationId: input.organizationId },
              orderBy: { calculatedAt: "desc" },
              take: 25,
              select: {
                marketplaceId: true,
                providerKey: true,
                calculationVersion: true,
                status: true,
                windowStart: true,
                windowEnd: true,
                coveragePercent: true,
                calculatedAt: true,
              },
            },
          },
        },
      },
    }),
  ]);

  return {
    total,
    offset,
    limit,
    universe:
      "ProductWatch records in this organization, including explicit active, paused, or archived state; this is not a global Amazon product universe.",
    rows: watches.map((watch) => {
      const estimate = watch.catalogProduct.salesEstimates.find(
        (candidate) => candidate.marketplaceId === watch.marketplaceId,
      );
      const history = watch.catalogProduct.historyAnalyticsAssessments.find(
        (candidate) => candidate.marketplaceId === watch.marketplaceId,
      );
      return {
        id: watch.id,
        status: watch.status,
        marketplaceId: watch.marketplaceId,
        cadenceMinutes: watch.cadenceMinutes,
        nextObservationAt: watch.nextObservationAt?.toISOString() ?? null,
        lastObservedAt: watch.lastObservedAt?.toISOString() ?? null,
        project: watch.project,
        product: {
          id: watch.catalogProduct.id,
          asin: watch.catalogProduct.asin,
          title: watch.catalogProduct.title,
          brand: watch.catalogProduct.brand,
          source: watch.catalogProduct.provider,
          observedAt: watch.catalogProduct.observedAt.toISOString(),
          freshnessState: watch.catalogProduct.freshnessState,
        },
        demandEstimate: estimate
          ? {
              monthlyUnitsLow: estimate.monthlyUnitsLow.toString(),
              monthlyUnitsHigh: estimate.monthlyUnitsHigh.toString(),
              confidencePercent: estimate.confidencePercent?.toString() ?? null,
              source: estimate.source,
              providerKey: estimate.providerKey,
              modelVersion: estimate.modelVersion,
              observedAt: estimate.observedAt.toISOString(),
            }
          : null,
        history: history
          ? {
              providerKey: history.providerKey,
              calculationVersion: history.calculationVersion,
              status: history.status,
              windowStart: history.windowStart?.toISOString() ?? null,
              windowEnd: history.windowEnd.toISOString(),
              coveragePercent: history.coveragePercent?.toString() ?? null,
              calculatedAt: history.calculatedAt.toISOString(),
            }
          : null,
      };
    }),
  };
}
