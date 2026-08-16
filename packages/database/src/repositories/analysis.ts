import type {
  Prisma,
  ProductRecommendation,
} from "../generated/prisma/client.js";
import { db } from "../client.js";

export async function listProfitResultsForScan(
  organizationId: string,
  scanJobId: string,
) {
  return db.profitResult.findMany({
    where: {
      organizationId,
      profitCalculationRun: { scanJobId, organizationId },
    },
    include: {
      shippingRoute: {
        select: { name: true, currency: true, effectiveFrom: true },
      },
      supplierRow: { select: { sourceRowNumber: true } },
    },
    orderBy: [
      { supplierRow: { sourceRowNumber: "asc" } },
      { updatedAt: "desc" },
    ],
  });
}

export type AnalysisFilters = {
  recommendation?: ProductRecommendation | undefined;
  search?: string | undefined;
  minRoiPercent?: string | undefined;
  maxRoiPercent?: string | undefined;
  minNetProfit?: string | undefined;
  maxNetProfit?: string | undefined;
  minMarginPercent?: string | undefined;
  maxMarginPercent?: string | undefined;
  status?: "COMPLETED" | "PARTIAL_SUCCESS" | undefined;
  matchStatus?:
    | "AUTO_ACCEPTED"
    | "REVIEW_REQUIRED"
    | "UNMATCHED"
    | "USER_ACCEPTED"
    | "USER_REJECTED"
    | undefined;
  minMatchConfidence?: number | undefined;
  packGuardStatus?:
    | "VERIFIED"
    | "BLOCKED_PACK_UNCERTAIN"
    | "BLOCKED_PACK_CONTRADICTION"
    | undefined;
  featuredOfferState?: "PRESENT" | "ABSENT" | "UNKNOWN" | undefined;
  amazonRetailPresence?: "PRESENT" | "ABSENT" | "UNKNOWN" | undefined;
  pricingCompleteness?: "COMPLETE" | "PARTIAL" | "UNKNOWN" | undefined;
  pricingFreshness?: "FRESH" | "STALE" | "EXPIRED" | "UNKNOWN" | undefined;
  feeCompleteness?: "COMPLETE" | "PARTIAL" | "UNKNOWN" | undefined;
  restrictionState?:
    | "ELIGIBLE"
    | "RESTRICTED"
    | "APPROVAL_REQUIRED"
    | "INCOMPLETE"
    | "UNAUTHORIZED"
    | "THROTTLED"
    | "UNKNOWN"
    | undefined;
  restrictionReasonCode?:
    "APPROVAL_REQUIRED" | "ASIN_NOT_FOUND" | "NOT_ELIGIBLE" | undefined;
  minFbaOfferCount?: number | undefined;
  maxFbaOfferCount?: number | undefined;
  minFbmOfferCount?: number | undefined;
  maxFbmOfferCount?: number | undefined;
  minVisibleOfferCount?: number | undefined;
  maxVisibleOfferCount?: number | undefined;
  partialData?: boolean | undefined;
  supplierCode?: string | undefined;
  brand?: string | undefined;
  category?: string | undefined;
};

export type AnalysisSort =
  | "sourceRowNumber"
  | "recommendation"
  | "currentNetProfit"
  | "conservativeNetProfit"
  | "roiPercent"
  | "marginPercent"
  | "breakEvenPrice";

function analysisWhere(
  organizationId: string,
  scanJobId: string,
  shippingRouteId: string,
  filters: AnalysisFilters,
): Prisma.ProfitResultWhereInput {
  const search = filters.search?.trim();
  const hasPricingFilter =
    filters.featuredOfferState !== undefined ||
    filters.amazonRetailPresence !== undefined ||
    filters.pricingCompleteness !== undefined ||
    filters.pricingFreshness !== undefined ||
    filters.minVisibleOfferCount !== undefined ||
    filters.maxVisibleOfferCount !== undefined ||
    filters.minFbaOfferCount !== undefined ||
    filters.maxFbaOfferCount !== undefined ||
    filters.minFbmOfferCount !== undefined ||
    filters.maxFbmOfferCount !== undefined;
  const typedObservationFilters: Prisma.ProfitResultWhereInput[] = [];
  if (filters.feeCompleteness)
    typedObservationFilters.push({
      supplierRow: {
        enrichmentItems: {
          some: {
            observations: {
              some: {
                metricType: "FEES",
                feeScenarioSource: "CURRENT_FEATURED_OFFER",
                completeness: filters.feeCompleteness,
              },
            },
          },
        },
      },
    });
  if (filters.restrictionState || filters.restrictionReasonCode)
    typedObservationFilters.push({
      supplierRow: {
        enrichmentItems: {
          some: {
            observations: {
              some: {
                metricType: "RESTRICTIONS",
                ...(filters.restrictionState
                  ? { restrictionState: filters.restrictionState }
                  : {}),
                ...(filters.restrictionReasonCode
                  ? {
                      restrictionReasonCodes: {
                        has: filters.restrictionReasonCode,
                      },
                    }
                  : {}),
              },
            },
          },
        },
      },
    });
  if (filters.matchStatus || filters.minMatchConfidence !== undefined)
    typedObservationFilters.push({
      supplierRow: {
        matchDecision: {
          ...(filters.matchStatus ? { status: filters.matchStatus } : {}),
          ...(filters.minMatchConfidence !== undefined
            ? { confidence: { gte: filters.minMatchConfidence } }
            : {}),
        },
      },
    });
  if (filters.packGuardStatus)
    typedObservationFilters.push({
      supplierRow: {
        matchDecision: {
          selectedCandidate: {
            packGuard: { status: filters.packGuardStatus },
          },
        },
      },
    });
  if (filters.brand)
    typedObservationFilters.push({
      OR: [
        {
          supplierRow: {
            normalizedOffer: {
              brand: { equals: filters.brand, mode: "insensitive" },
            },
          },
        },
        {
          supplierRow: {
            matchDecision: {
              selectedCandidate: {
                catalogProduct: {
                  brand: { equals: filters.brand, mode: "insensitive" },
                },
              },
            },
          },
        },
      ],
    });
  if (filters.category)
    typedObservationFilters.push({
      supplierRow: {
        matchDecision: {
          selectedCandidate: {
            catalogProduct: {
              identityProjection: {
                path: ["productTypes"],
                array_contains: filters.category,
              },
            },
          },
        },
      },
    });
  if (filters.partialData)
    typedObservationFilters.push({
      OR: [
        { status: "PARTIAL_SUCCESS" },
        {
          supplierRow: {
            enrichmentItems: {
              some: {
                observations: {
                  some: {
                    OR: [
                      { completeness: { not: "COMPLETE" } },
                      { freshnessState: { not: "FRESH" } },
                    ],
                  },
                },
              },
            },
          },
        },
      ],
    });
  return {
    organizationId,
    scanJobId,
    shippingRouteId,
    isCurrent: true,
    ...(typedObservationFilters.length ? { AND: typedObservationFilters } : {}),
    ...(filters.recommendation
      ? { recommendation: filters.recommendation }
      : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.minRoiPercent
      ? { roiPercent: { gte: filters.minRoiPercent } }
      : {}),
    ...(filters.maxRoiPercent
      ? { roiPercent: { lte: filters.maxRoiPercent } }
      : {}),
    ...(filters.minNetProfit
      ? { currentNetProfit: { gte: filters.minNetProfit } }
      : {}),
    ...(filters.maxNetProfit
      ? { currentNetProfit: { lte: filters.maxNetProfit } }
      : {}),
    ...(filters.minMarginPercent
      ? { marginPercent: { gte: filters.minMarginPercent } }
      : {}),
    ...(filters.maxMarginPercent
      ? { marginPercent: { lte: filters.maxMarginPercent } }
      : {}),
    ...(filters.supplierCode
      ? { scanJob: { supplier: { code: filters.supplierCode } } }
      : {}),
    ...(hasPricingFilter
      ? {
          supplierRow: {
            enrichmentItems: {
              some: {
                observations: {
                  some: {
                    metricType: "PRICING",
                    ...(filters.featuredOfferState
                      ? { featuredOfferState: filters.featuredOfferState }
                      : {}),
                    ...(filters.amazonRetailPresence
                      ? {
                          amazonRetailPresence: filters.amazonRetailPresence,
                        }
                      : {}),
                    ...(filters.pricingCompleteness
                      ? { completeness: filters.pricingCompleteness }
                      : {}),
                    ...(filters.pricingFreshness
                      ? { freshnessState: filters.pricingFreshness }
                      : {}),
                    ...(filters.minVisibleOfferCount !== undefined ||
                    filters.maxVisibleOfferCount !== undefined
                      ? {
                          visibleOfferCount: {
                            ...(filters.minVisibleOfferCount !== undefined
                              ? { gte: filters.minVisibleOfferCount }
                              : {}),
                            ...(filters.maxVisibleOfferCount !== undefined
                              ? { lte: filters.maxVisibleOfferCount }
                              : {}),
                          },
                        }
                      : {}),
                    ...(filters.minFbaOfferCount !== undefined ||
                    filters.maxFbaOfferCount !== undefined
                      ? {
                          fbaOfferCount: {
                            ...(filters.minFbaOfferCount !== undefined
                              ? { gte: filters.minFbaOfferCount }
                              : {}),
                            ...(filters.maxFbaOfferCount !== undefined
                              ? { lte: filters.maxFbaOfferCount }
                              : {}),
                          },
                        }
                      : {}),
                    ...(filters.minFbmOfferCount !== undefined ||
                    filters.maxFbmOfferCount !== undefined
                      ? {
                          fbmOfferCount: {
                            ...(filters.minFbmOfferCount !== undefined
                              ? { gte: filters.minFbmOfferCount }
                              : {}),
                            ...(filters.maxFbmOfferCount !== undefined
                              ? { lte: filters.maxFbmOfferCount }
                              : {}),
                          },
                        }
                      : {}),
                  },
                },
              },
            },
          },
        }
      : {}),
    ...(search
      ? {
          OR: [
            {
              supplierRow: {
                normalizedOffer: {
                  asin: { contains: search, mode: "insensitive" },
                },
              },
            },
            {
              supplierRow: {
                matchDecision: {
                  selectedCandidate: {
                    catalogProduct: {
                      asin: { contains: search, mode: "insensitive" },
                    },
                  },
                },
              },
            },
            {
              supplierRow: {
                normalizedOffer: {
                  itemNumber: { contains: search, mode: "insensitive" },
                },
              },
            },
            {
              supplierRow: {
                normalizedOffer: {
                  description: { contains: search, mode: "insensitive" },
                },
              },
            },
            {
              supplierRow: {
                normalizedOffer: {
                  brand: { contains: search, mode: "insensitive" },
                },
              },
            },
          ],
        }
      : {}),
  };
}

function analysisOrderBy(
  sort: AnalysisSort,
  direction: "asc" | "desc",
): Prisma.ProfitResultOrderByWithRelationInput[] {
  if (sort === "sourceRowNumber")
    return [{ supplierRow: { sourceRowNumber: direction } }, { id: "asc" }];
  if (sort === "recommendation")
    return [{ recommendation: direction }, { id: "asc" }];
  return [{ [sort]: direction }, { id: "asc" }];
}

export async function listAnalysisResults(input: {
  organizationId: string;
  scanJobId: string;
  shippingRouteId?: string;
  offset: number;
  limit: number;
  filters: AnalysisFilters;
  sort: AnalysisSort;
  direction: "asc" | "desc";
}) {
  const scan = await db.scanJob.findFirst({
    where: { id: input.scanJobId, organizationId: input.organizationId },
    select: {
      id: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      completedAt: true,
      supplier: { select: { code: true, name: true } },
      upload: { select: { originalFilename: true, status: true } },
      checkpoints: {
        select: { stage: true, updatedAt: true },
        orderBy: { createdAt: "asc" },
      },
      events: {
        where: {
          eventType: { in: ["FAILED_RETRYABLE", "FAILED_FINAL"] },
        },
        select: { eventType: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 3,
      },
      _count: { select: { supplierRows: true } },
    },
  });
  if (!scan) return null;
  const context = {
    id: scan.id,
    status: scan.status,
    createdAt: scan.createdAt.toISOString(),
    updatedAt: scan.updatedAt.toISOString(),
    completedAt: scan.completedAt?.toISOString() ?? null,
    supplier: scan.supplier,
    upload: scan.upload,
    rowCount: scan._count.supplierRows,
    checkpoints: scan.checkpoints.map((checkpoint) => ({
      stage: checkpoint.stage,
      updatedAt: checkpoint.updatedAt.toISOString(),
    })),
    recoverableErrors: scan.events.map((event) => ({
      status: event.eventType,
      observedAt: event.createdAt.toISOString(),
    })),
  };
  let shippingRouteId: string | undefined;
  if (input.shippingRouteId) {
    const route = await db.shippingRoute.findFirst({
      where: {
        id: input.shippingRouteId,
        organizationId: input.organizationId,
      },
      select: { id: true },
    });
    shippingRouteId = route?.id;
  } else {
    const route = await db.profitResult.findFirst({
      where: {
        organizationId: input.organizationId,
        scanJobId: input.scanJobId,
        isCurrent: true,
      },
      select: { shippingRouteId: true },
      orderBy: { updatedAt: "desc" },
    });
    shippingRouteId = route?.shippingRouteId;
  }
  if (!shippingRouteId) {
    const currentResultCount = await db.profitResult.count({
      where: {
        organizationId: input.organizationId,
        scanJobId: input.scanJobId,
        isCurrent: true,
      },
    });
    return {
      total: 0,
      unfilteredTotal: currentResultCount,
      rows: [],
      routes: [],
      context,
    };
  }
  const where = analysisWhere(
    input.organizationId,
    input.scanJobId,
    shippingRouteId,
    input.filters,
  );
  const [total, unfilteredTotal, rows, routes] = await db.$transaction([
    db.profitResult.count({ where }),
    db.profitResult.count({
      where: {
        organizationId: input.organizationId,
        scanJobId: input.scanJobId,
        shippingRouteId,
        isCurrent: true,
      },
    }),
    db.profitResult.findMany({
      where,
      skip: input.offset,
      take: input.limit,
      orderBy: analysisOrderBy(input.sort, input.direction),
      select: {
        id: true,
        status: true,
        recommendation: true,
        currentNetProfit: true,
        currentProceeds: true,
        conservativeNetProfit: true,
        stressNetProfit: true,
        userEnteredNetProfit: true,
        effectiveCogs: true,
        amazonFees: true,
        roiPercent: true,
        marginPercent: true,
        breakEvenPrice: true,
        reasonCodes: true,
        supplierRow: {
          select: {
            sourceRowNumber: true,
            normalizedOffer: {
              select: {
                asin: true,
                upc: true,
                ean: true,
                gtin: true,
                itemNumber: true,
                mpn: true,
                description: true,
                brand: true,
                unitCost: true,
                currency: true,
                quantity: true,
                caseCount: true,
                packCount: true,
              },
            },
            warnings: { select: { code: true, severity: true } },
            matchDecision: {
              select: {
                status: true,
                confidence: true,
                selectedCandidate: {
                  select: {
                    catalogProduct: {
                      select: {
                        asin: true,
                        title: true,
                        brand: true,
                        model: true,
                        mpn: true,
                        sizeText: true,
                        variation: true,
                        provider: true,
                        observedAt: true,
                        freshnessState: true,
                        packCount: true,
                        identityProjection: true,
                      },
                    },
                    packGuard: { select: { status: true, reasonCode: true } },
                  },
                },
              },
            },
            enrichmentItems: {
              select: {
                observations: {
                  select: {
                    metricType: true,
                    observationKey: true,
                    provider: true,
                    observedAt: true,
                    freshUntil: true,
                    freshnessState: true,
                    primaryAmount: true,
                    quotedPrice: true,
                    currency: true,
                    payload: true,
                    operation: true,
                    observationStatus: true,
                    requestHash: true,
                    completeness: true,
                    rawEvidenceReference: true,
                    asin: true,
                    marketplaceId: true,
                    featuredOfferState: true,
                    featuredPrice: true,
                    featuredCurrency: true,
                    featuredFulfillment: true,
                    featuredSellerId: true,
                    amazonRetailPresence: true,
                    visibleOfferCount: true,
                    visibleOfferCountCompleteness: true,
                    fbaOfferCount: true,
                    fbaOfferCountCompleteness: true,
                    fbmOfferCount: true,
                    fbmOfferCountCompleteness: true,
                    lowestFbaPrice: true,
                    lowestFbmPrice: true,
                    feeScenarioSource: true,
                    feeFulfillment: true,
                    feeComponents: {
                      select: {
                        ordinal: true,
                        feeType: true,
                        parentFeeType: true,
                        currency: true,
                        feeAmount: true,
                        promotionAmount: true,
                        taxAmount: true,
                        finalFee: true,
                      },
                      orderBy: { ordinal: "asc" },
                    },
                    restrictionState: true,
                    restrictionReasonCodes: true,
                    restrictionReasons: true,
                    restrictionConditionType: true,
                  },
                },
              },
            },
            profitCostOverrides: {
              where: { organizationId: input.organizationId, shippingRouteId },
              select: {
                revision: true,
                status: true,
                stressDiscountPercent: true,
                userEnteredSalePrice: true,
                updatedAt: true,
                values: { select: { field: true, value: true } },
              },
            },
          },
        },
      },
    }),
    db.shippingRoute.findMany({
      where: {
        organizationId: input.organizationId,
        profitResults: {
          some: { scanJobId: input.scanJobId, isCurrent: true },
        },
      },
      select: { id: true, name: true, currency: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const projectedRows = rows.map((row) => {
    const observations = row.supplierRow.enrichmentItems.flatMap(
      (item) => item.observations,
    );
    const external = (metricType: "PRICING" | "FEES" | "RESTRICTIONS") => {
      const observation = observations
        .filter((candidate) => candidate.metricType === metricType)
        .sort(
          (left, right) =>
            right.observedAt.getTime() - left.observedAt.getTime(),
        )[0];
      if (!observation) return null;
      return {
        provider: observation.provider,
        observedAt: observation.observedAt.toISOString(),
        freshUntil: observation.freshUntil.toISOString(),
        freshnessState: observation.freshnessState,
        value: observation.primaryAmount?.toString() ?? null,
        currency: observation.currency,
        restrictionStatus:
          metricType === "RESTRICTIONS" ? observation.restrictionState : null,
      };
    };
    const pricing = observations
      .filter((candidate) => candidate.metricType === "PRICING")
      .sort(
        (left, right) => right.observedAt.getTime() - left.observedAt.getTime(),
      )[0];
    const feeObservations = observations
      .filter((candidate) => candidate.metricType === "FEES")
      .sort((left, right) => {
        const sourceOrder =
          Number(right.feeScenarioSource === "CURRENT_FEATURED_OFFER") -
          Number(left.feeScenarioSource === "CURRENT_FEATURED_OFFER");
        return (
          sourceOrder || right.observedAt.getTime() - left.observedAt.getTime()
        );
      });
    const fee = feeObservations[0];
    const restriction = observations
      .filter((candidate) => candidate.metricType === "RESTRICTIONS")
      .sort(
        (left, right) => right.observedAt.getTime() - left.observedAt.getTime(),
      )[0];
    const { enrichmentItems, ...supplierRow } = row.supplierRow;
    const selectedCatalog =
      supplierRow.matchDecision?.selectedCandidate?.catalogProduct;
    const identityProjection = selectedCatalog?.identityProjection;
    const identity =
      identityProjection && typeof identityProjection === "object"
        ? (identityProjection as {
            manufacturer?: unknown;
            color?: unknown;
            productTypes?: unknown;
            variationTheme?: unknown;
            images?: unknown;
          })
        : null;
    const imageCandidates = Array.isArray(identity?.images)
      ? identity.images
          .filter(
            (image): image is { url: string; variant?: string } =>
              image !== null &&
              typeof image === "object" &&
              typeof (image as { url?: unknown }).url === "string",
          )
          .map((image) => ({ url: image.url, variant: image.variant ?? null }))
      : [];
    const normalizedCatalog = selectedCatalog
      ? {
          ...selectedCatalog,
          identity: {
            manufacturer:
              typeof identity?.manufacturer === "string"
                ? identity.manufacturer
                : null,
            color: typeof identity?.color === "string" ? identity.color : null,
            productTypes: Array.isArray(identity?.productTypes)
              ? identity.productTypes.filter(
                  (value): value is string => typeof value === "string",
                )
              : [],
            variationTheme:
              typeof identity?.variationTheme === "string"
                ? identity.variationTheme
                : null,
            images: imageCandidates,
          },
        }
      : null;
    const normalizedSupplierRow = {
      ...supplierRow,
      matchDecision: supplierRow.matchDecision
        ? {
            ...supplierRow.matchDecision,
            selectedCandidate: supplierRow.matchDecision.selectedCandidate
              ? {
                  ...supplierRow.matchDecision.selectedCandidate,
                  catalogProduct: normalizedCatalog,
                }
              : null,
          }
        : null,
    };
    void enrichmentItems;
    return {
      ...row,
      supplierRow: normalizedSupplierRow,
      externalEvidence: {
        pricing: external("PRICING"),
        fees: external("FEES"),
        restrictions: external("RESTRICTIONS"),
      },
      offerIntelligence: pricing
        ? {
            asin: pricing.asin,
            marketplaceId: pricing.marketplaceId,
            provider: pricing.provider,
            operation: pricing.operation,
            status: pricing.observationStatus,
            observedAt: pricing.observedAt.toISOString(),
            expiresAt: pricing.freshUntil.toISOString(),
            freshnessState: pricing.freshnessState,
            requestHash: pricing.requestHash,
            completeness: pricing.completeness,
            rawEvidenceReference: pricing.rawEvidenceReference,
            featuredOffer: {
              state: pricing.featuredOfferState,
              price: pricing.featuredPrice?.toString() ?? null,
              currency: pricing.featuredCurrency,
              fulfillmentChannel: pricing.featuredFulfillment,
              sellerId: pricing.featuredSellerId,
            },
            amazonRetailPresence: pricing.amazonRetailPresence,
            counts: {
              total: {
                value: pricing.visibleOfferCount,
                completeness: pricing.visibleOfferCountCompleteness,
              },
              fba: {
                value: pricing.fbaOfferCount,
                completeness: pricing.fbaOfferCountCompleteness,
              },
              fbm: {
                value: pricing.fbmOfferCount,
                completeness: pricing.fbmOfferCountCompleteness,
              },
            },
            lowestFbaPrice: pricing.lowestFbaPrice?.toString() ?? null,
            lowestFbmPrice: pricing.lowestFbmPrice?.toString() ?? null,
          }
        : null,
      feeEstimate: fee
        ? {
            asin: fee.asin,
            marketplaceId: fee.marketplaceId,
            provider: fee.provider,
            operation: fee.operation,
            status: fee.observationStatus,
            observedAt: fee.observedAt.toISOString(),
            expiresAt: fee.freshUntil.toISOString(),
            freshnessState: fee.freshnessState,
            requestHash: fee.requestHash,
            rawEvidenceReference: fee.rawEvidenceReference,
            completeness: fee.completeness,
            scenarioSource: fee.feeScenarioSource,
            fulfillmentChannel: fee.feeFulfillment,
            scenarioPrice: fee.quotedPrice?.toString() ?? null,
            total: fee.primaryAmount?.toString() ?? null,
            currency: fee.currency,
            components: fee.feeComponents.map((component) => ({
              type: component.feeType,
              parentType: component.parentFeeType,
              currency: component.currency,
              amount: component.feeAmount.toString(),
              promotion: component.promotionAmount?.toString() ?? null,
              tax: component.taxAmount?.toString() ?? null,
              finalFee: component.finalFee.toString(),
            })),
          }
        : null,
      feeScenarios: feeObservations.map((scenario) => ({
        observationKey: scenario.observationKey,
        scenarioSource: scenario.feeScenarioSource,
        scenarioPrice: scenario.quotedPrice?.toString() ?? null,
        total: scenario.primaryAmount?.toString() ?? null,
        currency: scenario.currency,
        fulfillmentChannel: scenario.feeFulfillment,
        completeness: scenario.completeness,
        status: scenario.observationStatus,
        provider: scenario.provider,
        observedAt: scenario.observedAt.toISOString(),
        expiresAt: scenario.freshUntil.toISOString(),
        freshnessState: scenario.freshnessState,
        requestHash: scenario.requestHash,
        components: scenario.feeComponents.map((component) => ({
          type: component.feeType,
          parentType: component.parentFeeType,
          currency: component.currency,
          finalFee: component.finalFee.toString(),
        })),
      })),
      listingRestriction: restriction
        ? {
            asin: restriction.asin,
            marketplaceId: restriction.marketplaceId,
            provider: restriction.provider,
            operation: restriction.operation,
            status: restriction.observationStatus,
            observedAt: restriction.observedAt.toISOString(),
            expiresAt: restriction.freshUntil.toISOString(),
            freshnessState: restriction.freshnessState,
            requestHash: restriction.requestHash,
            rawEvidenceReference: restriction.rawEvidenceReference,
            completeness: restriction.completeness,
            state: restriction.restrictionState ?? "UNKNOWN",
            conditionType: restriction.restrictionConditionType,
            reasonCodes: restriction.restrictionReasonCodes,
            reasons: restriction.restrictionReasons ?? [],
          }
        : null,
    };
  });
  return {
    total,
    unfilteredTotal,
    rows: projectedRows,
    routes,
    shippingRouteId,
    context,
  };
}

export async function getAnalysisResult(
  organizationId: string,
  resultId: string,
) {
  const result = await db.profitResult.findFirst({
    where: { id: resultId, organizationId },
    include: {
      shippingRoute: true,
      supplierRow: {
        include: {
          normalizedOffer: true,
          warnings: true,
          matchDecision: {
            include: {
              selectedCandidate: {
                include: {
                  catalogProduct: {
                    select: {
                      id: true,
                      asin: true,
                      title: true,
                      brand: true,
                      model: true,
                      mpn: true,
                      sizeText: true,
                      packCount: true,
                      variation: true,
                      provider: true,
                      providerReference: true,
                      observedAt: true,
                      freshnessState: true,
                      marketplaceId: true,
                      responseCompleteness: true,
                      requestLineage: true,
                      identityProjection: true,
                    },
                  },
                  evidence: true,
                  packGuard: true,
                },
              },
            },
          },
          listingCandidates: {
            include: {
              catalogProduct: {
                select: {
                  id: true,
                  asin: true,
                  title: true,
                  brand: true,
                  model: true,
                  mpn: true,
                  sizeText: true,
                  packCount: true,
                  variation: true,
                  provider: true,
                  providerReference: true,
                  observedAt: true,
                  freshnessState: true,
                  marketplaceId: true,
                  responseCompleteness: true,
                  requestLineage: true,
                  identityProjection: true,
                },
              },
              evidence: true,
              packGuard: true,
            },
            orderBy: { confidence: "desc" },
          },
          enrichmentItems: {
            include: {
              observations: {
                select: {
                  metricType: true,
                  observationKey: true,
                  provider: true,
                  providerReference: true,
                  marketplaceId: true,
                  observedAt: true,
                  freshUntil: true,
                  freshnessState: true,
                  operation: true,
                  observationStatus: true,
                  requestHash: true,
                  completeness: true,
                  rawEvidenceReference: true,
                  asin: true,
                  currency: true,
                  primaryAmount: true,
                  quotedPrice: true,
                  feeScenarioSource: true,
                  feeFulfillment: true,
                  feeComponents: {
                    select: {
                      ordinal: true,
                      feeType: true,
                      parentFeeType: true,
                      currency: true,
                      feeAmount: true,
                      promotionAmount: true,
                      taxAmount: true,
                      finalFee: true,
                    },
                    orderBy: { ordinal: "asc" },
                  },
                  restrictionState: true,
                  restrictionReasonCodes: true,
                  restrictionReasons: true,
                  restrictionConditionType: true,
                },
              },
            },
          },
          profitCostOverrides: {
            include: {
              values: true,
              events: { orderBy: { createdAt: "desc" } },
            },
          },
          profitResults: {
            where: { isCurrent: true },
            include: {
              shippingRoute: { select: { name: true, currency: true } },
            },
          },
        },
      },
    },
  });
  if (!result) return null;
  const auditEvents = await db.workflowAuditEvent.findMany({
    where: {
      organizationId,
      entityId: {
        in: [
          result.id,
          result.supplierRowId,
          ...(result.supplierRow.matchDecision?.id
            ? [result.supplierRow.matchDecision.id]
            : []),
        ],
      },
    },
    orderBy: { createdAt: "asc" },
  });
  const catalogProductId =
    result.supplierRow.matchDecision?.selectedCandidate?.catalogProduct?.id;
  const historyEvidence = catalogProductId
    ? await db.historicalMetricSeries.findMany({
        where: { organizationId, catalogProductId },
        select: {
          metricKey: true,
          providerKey: true,
          unit: true,
          currency: true,
          points: {
            select: {
              metricAt: true,
              decimalValue: true,
              integerValue: true,
              booleanValue: true,
              textValue: true,
              sourceObservation: {
                select: {
                  providerKey: true,
                  observedAt: true,
                  expiresAt: true,
                  freshnessState: true,
                  completeness: true,
                },
              },
            },
            orderBy: { metricAt: "desc" },
            take: 365,
          },
        },
        orderBy: { metricKey: "asc" },
      })
    : [];
  const historyAnalytics = catalogProductId
    ? await db.historyAnalyticsAssessment.findMany({
        where: { organizationId, catalogProductId },
        select: {
          providerKey: true,
          calculationVersion: true,
          status: true,
          windowStart: true,
          windowEnd: true,
          coveragePercent: true,
          metrics: true,
          warnings: true,
          inputPointReferences: true,
          calculatedAt: true,
        },
        orderBy: { calculatedAt: "desc" },
        take: 3,
      })
    : [];
  return { ...result, auditEvents, historyEvidence, historyAnalytics };
}
