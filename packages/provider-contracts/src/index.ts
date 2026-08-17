import { z } from "zod";

export const freshnessStateSchema = z.enum([
  "FRESH",
  "STALE",
  "EXPIRED",
  "UNKNOWN",
]);

export const provenanceSchema = z.object({
  provider: z.string().min(1),
  observedAt: z.iso.datetime(),
  freshnessState: freshnessStateSchema,
  providerReference: z.string().min(1).optional(),
  marketplaceId: z.string().min(1).optional(),
  requestId: z.string().min(1).optional(),
  responseCompleteness: z.enum(["COMPLETE", "PARTIAL"]).optional(),
});

export const decimalStringSchema = z.string().regex(/^-?\d+(\.\d+)?$/);

export const marketplaceContextSchema = z.object({
  marketplaceId: z.string().min(1),
  region: z.enum(["NA", "EU", "FE"]),
  sellerId: z.string().min(1).optional(),
  connectionId: z.string().min(1).optional(),
});
export type MarketplaceContext = z.infer<typeof marketplaceContextSchema>;

export const providerCapabilitySchema = z.enum([
  "CATALOG",
  "COMPETITIVE_OFFERS",
  "FEES",
  "RESTRICTIONS",
  "MARKET_HISTORY",
  "KEYWORD_DISCOVERY",
  "REVERSE_ASIN",
  "SEARCH_RANK",
  "CATEGORY_INTELLIGENCE",
  "BRAND_INTELLIGENCE",
  "SELLER_INTELLIGENCE",
  "AD_INTELLIGENCE",
  "REVIEW_INTELLIGENCE",
]);
export type ProviderCapability = z.infer<typeof providerCapabilitySchema>;

export const salesEstimateProviderRequestSchema = z.object({
  marketplaceId: z.string().min(1),
  asin: z.string().regex(/^B[A-Z0-9]{9}$/),
  categoryReference: z.string().min(1).optional(),
});
export type SalesEstimateProviderRequest = z.infer<
  typeof salesEstimateProviderRequestSchema
>;

export const salesEstimateProviderResultSchema = z
  .object({
    status: z.enum(["AVAILABLE", "UNAVAILABLE"]),
    monthlyUnitsLow: decimalStringSchema.optional(),
    monthlyUnitsHigh: decimalStringSchema.optional(),
    monthlyUnitsCentral: decimalStringSchema.optional(),
    confidencePercent: decimalStringSchema.optional(),
    modelVersion: z.string().min(1).optional(),
    reasonCode: z.string().min(1).optional(),
    provenance: provenanceSchema,
  })
  .superRefine((value, context) => {
    if (
      value.status === "AVAILABLE" &&
      (!value.monthlyUnitsLow || !value.monthlyUnitsHigh || !value.modelVersion)
    )
      context.addIssue({
        code: "custom",
        message:
          "Available sales estimates require a range and provider model version.",
      });
  });
export type SalesEstimateProviderResult = z.infer<
  typeof salesEstimateProviderResultSchema
>;

export interface SalesEstimateProvider {
  readonly providerKey: string;
  estimateMonthlyUnits(
    request: SalesEstimateProviderRequest,
  ): Promise<SalesEstimateProviderResult>;
}

export const keywordMetricSchema = z.object({
  phrase: z.string().min(1),
  searchVolume: decimalStringSchema.optional(),
  competingProductCount: decimalStringSchema.optional(),
  suggestedBid: decimalStringSchema.optional(),
  relatedTerms: z.array(z.string().min(1)).optional(),
  metrics: z.record(z.string(), z.unknown()).optional(),
  provenance: provenanceSchema,
  completeness: z.enum(["COMPLETE", "PARTIAL", "UNKNOWN"]),
});
export type KeywordMetric = z.infer<typeof keywordMetricSchema>;
export interface KeywordIntelligenceProvider {
  readonly providerKey: string;
  discover(input: {
    marketplaceId: string;
    locale: string;
    seed: string;
  }): Promise<readonly KeywordMetric[]>;
}

export interface BrandAnalyticsProvider {
  readonly providerKey: string;
  requestSearchQueryPerformance(input: {
    marketplaceId: string;
    brandReference: string;
    startDate: string;
    endDate: string;
  }): Promise<{
    requestId: string;
    status: "QUEUED" | "UNSUPPORTED" | "INELIGIBLE";
    reasonCode?: string;
  }>;
}

/** Optional boundary for licensed seller/competitor datasets. It is not a
 * storefront-scraping contract and may return only permitted business data. */
export interface SellerIntelligenceProvider {
  readonly providerKey: string;
  searchSellers(input: {
    marketplaceId: string;
    query: string;
    limit: number;
  }): Promise<
    readonly {
      sellerReference: string;
      displayName?: string;
      knownProductCount?: string;
      metrics?: Record<string, unknown>;
      provenance: z.infer<typeof provenanceSchema>;
      completeness: "COMPLETE" | "PARTIAL" | "UNKNOWN";
    }[]
  >;
}

export type ProductRelationshipType =
  | "FREQUENTLY_BOUGHT_TOGETHER"
  | "ALSO_VIEWED"
  | "RELATED_RECOMMENDED"
  | "SHARED_KEYWORD"
  | "SHARED_MARKET"
  | "CO_RANKING"
  | "VARIANT_FAMILY";

/** Direct behavioral types require a licensed source. Derived types must be
 * surfaced as derived similarity in every caller-facing DTO. */
export interface ProductRelationshipProvider {
  readonly providerKey: string;
  neighbors(input: {
    marketplaceId: string;
    asin: string;
    relationshipTypes?: readonly ProductRelationshipType[];
  }): Promise<
    readonly {
      relatedAsin: string;
      type: ProductRelationshipType;
      strength: string;
      confidence: "HIGH" | "MEDIUM" | "LOW";
      provenance: z.infer<typeof provenanceSchema>;
    }[]
  >;
}

export const advertisingObservationSchema = z.object({
  marketplaceId: z.string().min(1),
  keyword: z.string().min(1),
  sponsoredAsin: z
    .string()
    .regex(/^B[A-Z0-9]{9}$/)
    .optional(),
  advertiserReference: z.string().min(1).optional(),
  sponsoredPosition: z.number().int().positive().optional(),
  visibilityFrequency: decimalStringSchema.optional(),
  shareOfVoice: decimalStringSchema.optional(),
  cpcLow: decimalStringSchema.optional(),
  cpcHigh: decimalStringSchema.optional(),
  provenance: provenanceSchema,
  completeness: z.enum(["COMPLETE", "PARTIAL", "UNKNOWN"]),
});
export type AdvertisingObservation = z.infer<
  typeof advertisingObservationSchema
>;

/** Optional licensed or authorized first-party advertising visibility source.
 * Implementations must never obtain sponsored placements through HTML scraping. */
export interface AdvertisingIntelligenceProvider {
  readonly providerKey: string;
  findSponsoredVisibility(input: {
    marketplaceId: string;
    keywords?: readonly string[];
    asins?: readonly string[];
  }): Promise<readonly AdvertisingObservation[]>;
}

export const providerOperationalStateSchema = z.enum([
  "NOT_CONFIGURED",
  "CONFIGURED",
  "AUTHORIZED",
  "UNAUTHORIZED",
  "QUOTA_EXHAUSTED",
  "THROTTLED",
  "UNAVAILABLE",
  "PARTIAL",
  "HEALTHY",
]);
export type ProviderOperationalState = z.infer<
  typeof providerOperationalStateSchema
>;

export const providerRuntimeModeSchema = z.enum(["MOCK", "LIVE"]);
export type ProviderRuntimeMode = z.infer<typeof providerRuntimeModeSchema>;

export const providerUnavailableReasonSchema = z.enum([
  "CREDENTIALS_MISSING",
  "CONNECTION_NOT_AUTHORIZED",
  "CAPABILITY_NOT_ENTITLED",
  "QUOTA_WINDOW_EXHAUSTED",
  "PROVIDER_THROTTLED",
  "PROVIDER_OUTAGE",
  "PARTIAL_RESPONSE",
  "STALE_CACHE_ONLY",
  "UNSUPPORTED_BY_PROVIDER",
  "DATA_NOT_RETURNED",
  "RATE_BUDGET_NOT_CONFIGURED",
  "REQUEST_ALREADY_SETTLED",
]);
export type ProviderUnavailableReason = z.infer<
  typeof providerUnavailableReasonSchema
>;

export const providerCapabilityStateSchema = z.object({
  providerKey: z.string().min(1),
  marketplaceId: z.string().min(1),
  capability: providerCapabilitySchema,
  mode: providerRuntimeModeSchema,
  state: providerOperationalStateSchema,
  checkedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime().optional(),
  retryAt: z.iso.datetime().optional(),
  reason: providerUnavailableReasonSchema.optional(),
  completeness: z.enum(["COMPLETE", "PARTIAL", "UNKNOWN"]),
});
export type ProviderCapabilityState = z.infer<
  typeof providerCapabilityStateSchema
>;

export const providerHealthSchema = z.object({
  provider: z.string().min(1),
  mode: providerRuntimeModeSchema,
  status: providerOperationalStateSchema,
  checkedAt: z.iso.datetime(),
  lastErrorCode: z.string().min(1).optional(),
  capabilities: z.array(providerCapabilityStateSchema).default([]),
});
export type ProviderHealth = z.infer<typeof providerHealthSchema>;

export const providerFreshnessPolicySchema = z
  .object({
    capability: providerCapabilitySchema,
    freshForSeconds: z.number().int().positive(),
    staleWhileRevalidateSeconds: z.number().int().nonnegative(),
    retainForSeconds: z.number().int().positive(),
  })
  .refine(
    ({ freshForSeconds, retainForSeconds }) =>
      retainForSeconds >= freshForSeconds,
    { message: "Retention must cover the fresh window" },
  );
export type ProviderFreshnessPolicy = z.infer<
  typeof providerFreshnessPolicySchema
>;

export const providerBudgetUnitSchema = z.enum(["REQUEST", "CREDIT", "TOKEN"]);
export type ProviderBudgetUnit = z.infer<typeof providerBudgetUnitSchema>;

export const providerCostEstimateSchema = z.object({
  unit: providerBudgetUnitSchema,
  estimatedUnits: decimalStringSchema,
  estimatedMoney: decimalStringSchema.optional(),
  currency: z.string().length(3).optional(),
});
export type ProviderCostEstimate = z.infer<typeof providerCostEstimateSchema>;

export const providerCacheLookupSchema = z.object({
  outcome: z.enum(["MISS", "FRESH_HIT", "STALE_HIT", "EXPIRED"]),
  observedAt: z.iso.datetime().optional(),
  freshUntil: z.iso.datetime().optional(),
  staleUntil: z.iso.datetime().optional(),
  completeness: z.enum(["COMPLETE", "PARTIAL", "UNKNOWN"]).optional(),
});
export type ProviderCacheLookup = z.infer<typeof providerCacheLookupSchema>;

export const providerRequestTelemetrySchema = z.object({
  providerKey: z.string().min(1),
  marketplaceId: z.string().min(1),
  capability: providerCapabilitySchema,
  operation: z.string().min(1),
  requestHash: z.string().min(1),
  mode: providerRuntimeModeSchema,
  state: providerOperationalStateSchema,
  attempt: z.number().int().positive(),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().optional(),
  retryAt: z.iso.datetime().optional(),
  cacheOutcome: providerCacheLookupSchema.shape.outcome.optional(),
  cost: providerCostEstimateSchema.optional(),
  errorCode: z.string().min(1).optional(),
});
export type ProviderRequestTelemetry = z.infer<
  typeof providerRequestTelemetrySchema
>;

export class ProviderError extends Error {
  constructor(
    readonly code:
      | "THROTTLED"
      | "UNAUTHORIZED"
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "TRANSIENT"
      | "PROVIDER_OUTAGE"
      | "INVALID_REQUEST"
      | "PERMANENT"
      | "INVALID_RESPONSE",
    readonly options: {
      readonly retryAfterMs?: number;
      readonly httpStatus?: number;
      readonly providerRequestId?: string;
    } = {},
  ) {
    super(code);
  }
}

export const observedMetricSchema = <T extends z.ZodType>(valueSchema: T) =>
  z.object({
    value: valueSchema,
    provenance: provenanceSchema,
  });

export const identifierTypeSchema = z.enum([
  "ASIN",
  "UPC",
  "EAN",
  "GTIN",
  "MPN",
]);
export type IdentifierType = z.infer<typeof identifierTypeSchema>;

export const catalogIdentifierSchema = z.object({
  type: identifierTypeSchema,
  value: z.string().trim().min(1),
});
export type CatalogIdentifier = z.infer<typeof catalogIdentifierSchema>;

/**
 * Catalog Items reports a unit with each physical measurement. Do not share a
 * unit across height/length/width and weight: a sellable package commonly has
 * inch dimensions and a pound weight.
 */
const catalogDimensionSchema = z.object({
  value: decimalStringSchema,
  unit: z.string().trim().min(1),
});

const catalogDimensionsSchema = z.union([
  z.object({
    height: catalogDimensionSchema.optional(),
    length: catalogDimensionSchema.optional(),
    width: catalogDimensionSchema.optional(),
    weight: catalogDimensionSchema.optional(),
  }),
  // Older persisted mock observations used a shared unit. Read them safely so
  // checkpoints remain resumable, but all new provider projections use the
  // per-dimension canonical shape above.
  z
    .object({
      height: decimalStringSchema.optional(),
      length: decimalStringSchema.optional(),
      width: decimalStringSchema.optional(),
      weight: decimalStringSchema.optional(),
      unit: z.string().trim().min(1).optional(),
    })
    .transform((legacy) => ({
      ...(legacy.height && legacy.unit
        ? { height: { value: legacy.height, unit: legacy.unit } }
        : {}),
      ...(legacy.length && legacy.unit
        ? { length: { value: legacy.length, unit: legacy.unit } }
        : {}),
      ...(legacy.width && legacy.unit
        ? { width: { value: legacy.width, unit: legacy.unit } }
        : {}),
      ...(legacy.weight && legacy.unit
        ? { weight: { value: legacy.weight, unit: legacy.unit } }
        : {}),
    })),
]);

export const catalogProductSchema = z.object({
  asin: z.string().regex(/^B[A-Z0-9]{9}$/),
  title: z.string().min(1),
  brand: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  mpn: z.string().min(1).optional(),
  sizeText: z.string().min(1).optional(),
  packCount: z.number().int().positive().optional(),
  variation: z.string().min(1).optional(),
  manufacturer: z.string().min(1).optional(),
  color: z.string().min(1).optional(),
  productTypes: z.array(z.string().min(1)).optional(),
  variationTheme: z.string().min(1).optional(),
  packageHierarchy: z
    .array(
      z.object({
        type: z.string().min(1),
        asin: z
          .string()
          .regex(/^B[A-Z0-9]{9}$/)
          .optional(),
      }),
    )
    .optional(),
  images: z
    .array(
      z.object({
        url: z.url(),
        variant: z.string().min(1).optional(),
        height: z.number().int().positive().optional(),
        width: z.number().int().positive().optional(),
      }),
    )
    .optional(),
  salesRanks: z
    .array(
      z.object({
        classificationId: z.string().min(1),
        rank: z.number().int().positive(),
      }),
    )
    .optional(),
  dimensions: catalogDimensionsSchema.optional(),
  identifiers: z.array(catalogIdentifierSchema),
  provenance: provenanceSchema,
  /** Private provider observation. Persistence may retain it; UI DTOs must not. */
  rawProviderObservation: z.unknown().optional(),
});
export type CatalogProduct = z.infer<typeof catalogProductSchema>;

export const listingCandidateSchema = catalogProductSchema;

export type ListingCandidate = z.infer<typeof listingCandidateSchema>;

export const currentOffersSchema = observedMetricSchema(
  z.array(
    z.object({
      sellerId: z.string().min(1),
      price: decimalStringSchema,
      currency: z.string().length(3),
    }),
  ),
);
export type CurrentOffers = z.infer<typeof currentOffersSchema>;

export const offerPresenceSchema = z.enum(["PRESENT", "ABSENT", "UNKNOWN"]);
export const offerCompletenessSchema = z.enum([
  "COMPLETE",
  "PARTIAL",
  "UNKNOWN",
]);
export const offerCountSchema = z.object({
  value: z.number().int().nonnegative().optional(),
  completeness: offerCompletenessSchema,
});
export const competitiveOfferSchema = z.object({
  sellerId: z.string().min(1).optional(),
  condition: z.string().min(1).optional(),
  fulfillmentChannel: z.enum(["AMAZON", "MERCHANT", "UNKNOWN"]),
  listingPrice: decimalStringSchema.optional(),
  shippingPrice: decimalStringSchema.optional(),
  landedPrice: decimalStringSchema.optional(),
  currency: z.string().length(3).optional(),
  memberships: z.array(z.enum(["PRIME", "NON_PRIME", "DEFAULT"])).default([]),
  isFeatured: z.boolean(),
});

export const competitivePricingSchema = observedMetricSchema(
  z.object({
    currency: z.string().length(3).optional(),
    buyBoxPrice: decimalStringSchema.optional(),
    lowestPrice: decimalStringSchema.optional(),
    offerCount: z.number().int().nonnegative().optional(),
    operation: z.literal("getCompetitiveSummary"),
    asin: z.string().regex(/^B[A-Z0-9]{9}$/),
    marketplaceId: z.string().min(1),
    featuredOfferState: offerPresenceSchema,
    featuredOffer: competitiveOfferSchema.optional(),
    completeness: offerCompletenessSchema,
    totalVisibleOffers: offerCountSchema,
    fbaVisibleOffers: offerCountSchema,
    fbmVisibleOffers: offerCountSchema,
    visibleOfferCount: z.number().int().nonnegative().optional(),
    fbaOfferCount: z.number().int().nonnegative().optional(),
    fbmOfferCount: z.number().int().nonnegative().optional(),
    amazonRetailPresence: z.enum(["PRESENT", "ABSENT", "UNKNOWN"]),
    brandSellerStatus: z.enum(["VERIFIED", "UNVERIFIED", "UNKNOWN"]),
    lowestFbaPrice: decimalStringSchema.optional(),
    lowestFbmPrice: decimalStringSchema.optional(),
    offers: z.array(competitiveOfferSchema).default([]),
  }),
).extend({ rawProviderObservation: z.unknown().optional() });
export type CompetitivePricing = z.infer<typeof competitivePricingSchema>;

export type CompetitivePricingBatchResult =
  | {
      readonly asin: string;
      readonly status: "SUCCESS";
      readonly pricing: CompetitivePricing;
    }
  | {
      readonly asin: string;
      readonly status: "ERROR";
      readonly error: {
        readonly code: ProviderError["code"];
        readonly retryAfterMs?: number;
        readonly httpStatus?: number;
        readonly providerRequestId?: string;
      };
    };

export const feeCompletenessSchema = z.enum(["COMPLETE", "PARTIAL", "UNKNOWN"]);
export const feeScenarioSourceSchema = z.enum([
  "CURRENT_FEATURED_OFFER",
  "CONSERVATIVE",
  "USER_ENTERED",
]);
export type FeeScenarioSource = z.infer<typeof feeScenarioSourceSchema>;
export const feeComponentSchema = z.object({
  feeType: z.string().min(1),
  feeAmount: decimalStringSchema,
  finalFee: decimalStringSchema,
  currency: z.string().length(3),
  promotion: decimalStringSchema.optional(),
  tax: decimalStringSchema.optional(),
  parentFeeType: z.string().min(1).optional(),
});
export type FeeComponent = z.infer<typeof feeComponentSchema>;

export const feeEstimateSchema = observedMetricSchema(
  z.object({
    operation: z.literal("getMyFeesEstimateForASIN"),
    asin: z.string().regex(/^B[A-Z0-9]{9}$/),
    marketplaceId: z.string().min(1),
    totalFee: decimalStringSchema,
    quotedPrice: decimalStringSchema,
    listingPrice: decimalStringSchema,
    shippingPrice: decimalStringSchema,
    currency: z.string().length(3),
    fulfillmentChannel: z.enum(["AMAZON", "MERCHANT"]),
    scenarioSource: feeScenarioSourceSchema,
    completeness: feeCompletenessSchema,
    components: z.array(feeComponentSchema),
    /** Deterministic fixture/config model only. Live SP-API responses never infer one. */
    model: z
      .object({
        fixedFee: decimalStringSchema,
        percentageOfPrice: decimalStringSchema,
        minimumFee: decimalStringSchema.optional(),
      })
      .optional(),
  }),
).extend({ rawProviderObservation: z.unknown().optional() });
export type FeeEstimate = z.infer<typeof feeEstimateSchema>;

export const feeEstimateRequestSchema = z.object({
  asin: z.string().regex(/^B[A-Z0-9]{9}$/),
  price: decimalStringSchema,
  listingPrice: decimalStringSchema.optional(),
  currency: z.string().length(3),
  fulfillmentChannel: z.enum(["AMAZON", "MERCHANT"]),
  scenarioSource: feeScenarioSourceSchema,
  shippingPrice: decimalStringSchema.default("0"),
  marketplace: marketplaceContextSchema,
  requestId: z.string().min(1),
});
export type FeeEstimateRequest = z.infer<typeof feeEstimateRequestSchema>;

export const restrictionStateSchema = z.enum([
  "ELIGIBLE",
  "RESTRICTED",
  "APPROVAL_REQUIRED",
  "INCOMPLETE",
  "UNAUTHORIZED",
  "THROTTLED",
  "UNKNOWN",
]);
export const restrictionReasonSchema = z.object({
  code: z.enum(["APPROVAL_REQUIRED", "ASIN_NOT_FOUND", "NOT_ELIGIBLE"]),
  message: z.string().min(1),
  links: z
    .array(
      z.object({
        resource: z.url(),
        verb: z.string().min(1).optional(),
        title: z.string().min(1).optional(),
        type: z.string().min(1).optional(),
      }),
    )
    .default([]),
});
export const restrictionsSchema = observedMetricSchema(
  z.object({
    operation: z.literal("getListingsRestrictions"),
    asin: z.string().regex(/^B[A-Z0-9]{9}$/),
    marketplaceId: z.string().min(1),
    state: restrictionStateSchema,
    completeness: z.enum(["COMPLETE", "PARTIAL", "UNKNOWN"]),
    conditionType: z.string().min(1).optional(),
    reasons: z.array(restrictionReasonSchema),
  }),
).extend({ rawProviderObservation: z.unknown().optional() });
export type Restrictions = z.infer<typeof restrictionsSchema>;

export const marketHistorySchema = observedMetricSchema(
  z.array(
    z.object({
      observedAt: z.iso.datetime(),
      price: decimalStringSchema,
      currency: z.string().length(3),
    }),
  ),
);
export type MarketHistory = z.infer<typeof marketHistorySchema>;

/**
 * A vendor-neutral, append-only historical projection.  Price values are
 * decimal text, never JavaScript numbers.  A point deliberately has exactly
 * one typed value so a missing metric can stay missing rather than becoming a
 * false zero.
 */
export const marketHistoryMetricKeySchema = z.enum([
  "AMAZON_PRICE",
  "NEW_OFFER_PRICE",
  "FEATURED_OFFER_PRICE",
  "SALES_RANK",
  "OFFER_COUNT",
  "AMAZON_RETAIL_PRESENT",
  "RATING",
  "REVIEW_COUNT",
  "PRODUCT_FIRST_OBSERVED_AT",
  "CATEGORY_CONTEXT",
]);
export type MarketHistoryMetricKey = z.infer<
  typeof marketHistoryMetricKeySchema
>;

const marketHistoryPointBaseSchema = z.object({
  observedAt: z.iso.datetime(),
  decimalValue: decimalStringSchema.optional(),
  integerValue: z
    .string()
    .regex(/^-?\d+$/)
    .optional(),
  booleanValue: z.boolean().optional(),
  textValue: z.string().min(1).optional(),
});

export const marketHistoryPointSchema = marketHistoryPointBaseSchema.refine(
  (point) =>
    [
      point.decimalValue !== undefined,
      point.integerValue !== undefined,
      point.booleanValue !== undefined,
      point.textValue !== undefined,
    ].filter(Boolean).length === 1,
  { message: "A history point needs exactly one typed value" },
);
export type MarketHistoryPoint = z.infer<typeof marketHistoryPointSchema>;

export const marketHistorySeriesSchema = z.object({
  metricKey: marketHistoryMetricKeySchema,
  unit: z.string().min(1),
  currency: z.string().length(3).optional(),
  points: z.array(marketHistoryPointSchema),
});
export type MarketHistorySeries = z.infer<typeof marketHistorySeriesSchema>;

export const marketHistoryProductSchema = z.object({
  asin: z.string().regex(/^B[A-Z0-9]{9}$/),
  marketplaceId: z.string().min(1),
  firstObservedAt: z.iso.datetime().optional(),
  categoryContext: z
    .array(
      z.object({
        categoryId: z.string().min(1),
        name: z.string().min(1).optional(),
        currentRank: z.string().regex(/^\d+$/).optional(),
      }),
    )
    .default([]),
  series: z.array(marketHistorySeriesSchema),
  completeness: z.enum(["COMPLETE", "PARTIAL", "UNKNOWN"]),
  /** Never rendered directly. A worker writes this to private storage. */
  rawProviderObservation: z.unknown().optional(),
});
export type MarketHistoryProduct = z.infer<typeof marketHistoryProductSchema>;

export const marketHistoryBatchSchema = observedMetricSchema(
  z.object({
    operation: z.literal("getProductHistory"),
    marketplaceId: z.string().min(1),
    products: z.array(marketHistoryProductSchema),
  }),
).extend({ rawProviderObservation: z.unknown().optional() });
export type MarketHistoryBatch = z.infer<typeof marketHistoryBatchSchema>;

export const marketHistoryRequestSchema = z.object({
  asins: z
    .array(z.string().regex(/^B[A-Z0-9]{9}$/))
    .min(1)
    .max(100),
  historyDays: z.number().int().positive().max(730).default(365),
  includeRatingAndReviews: z.boolean().default(true),
});
export type MarketHistoryRequest = z.infer<typeof marketHistoryRequestSchema>;

export const aiMatchRankingSchema = z.object({
  candidateAsin: z.string().regex(/^B[A-Z0-9]{9}$/),
  confidence: z.number().int().min(0).max(100),
  explanation: z.string().min(1),
});
export type AiMatchRanking = z.infer<typeof aiMatchRankingSchema>;

export interface CatalogProvider {
  searchByIdentifier(
    identifier: CatalogIdentifier,
    marketplace?: MarketplaceContext,
  ): Promise<readonly CatalogProduct[]>;
  /** Bounded exact-identifier lookup. Catalog Items currently permits at most 20 identifiers. */
  searchByIdentifiers?(
    identifiers: readonly CatalogIdentifier[],
    marketplace?: MarketplaceContext,
  ): Promise<readonly CatalogProduct[]>;
  searchByKeywords(
    keywords: string,
    marketplace?: MarketplaceContext,
  ): Promise<readonly ListingCandidate[]>;
  getItem(
    asin: string,
    marketplace?: MarketplaceContext,
  ): Promise<CatalogProduct | null>;
}

export interface PricingProvider {
  getCurrentOffers(
    asin: string,
    marketplace: MarketplaceContext,
  ): Promise<CurrentOffers>;
  getCompetitivePricing(
    asin: string,
    marketplace: MarketplaceContext,
  ): Promise<CompetitivePricing>;
  /** Product Pricing 2022-05-01 supports at most 20 ASIN requests per batch. */
  getCompetitivePricingBatch?(
    asins: readonly string[],
    marketplace: MarketplaceContext,
  ): Promise<readonly CompetitivePricingBatchResult[]>;
}

export interface FeeProvider {
  estimateFees(request: FeeEstimateRequest): Promise<FeeEstimate>;
}

export interface RestrictionProvider {
  getRestrictions(
    asin: string,
    marketplace: MarketplaceContext,
  ): Promise<Restrictions>;
}

export interface MarketHistoryProvider {
  /**
   * Normalized request used by licensed history vendors.  It is optional for
   * legacy providers until they support historical projections.
   */
  getProductHistory?(
    request: MarketHistoryRequest,
    marketplace: MarketplaceContext,
  ): Promise<MarketHistoryBatch>;
  /** Legacy price-only history retained for existing wholesale checkpoints. */
  getHistory(
    asin: string,
    marketplace: MarketplaceContext,
  ): Promise<MarketHistory>;
}

export interface ProviderHealthProvider {
  health(marketplace?: MarketplaceContext): Promise<ProviderHealth>;
}

/** Credential-free capability discovery. Implementations must return MOCK or
 * LIVE explicitly so fixture data can never be presented as live evidence. */
export interface ProviderCapabilityDiscovery {
  capabilities(
    marketplace: MarketplaceContext,
  ): Promise<readonly ProviderCapabilityState[]>;
}

export interface AiMatchProvider {
  rankCandidates(
    input: readonly ListingCandidate[],
  ): Promise<readonly AiMatchRanking[]>;
}
