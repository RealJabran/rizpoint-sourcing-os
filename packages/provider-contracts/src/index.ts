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

export const providerHealthSchema = z.object({
  provider: z.string().min(1),
  status: z.enum(["HEALTHY", "DEGRADED", "AUTH_REQUIRED", "UNAVAILABLE"]),
  checkedAt: z.iso.datetime(),
  lastErrorCode: z.string().min(1).optional(),
});
export type ProviderHealth = z.infer<typeof providerHealthSchema>;

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
  dimensions: z
    .object({
      height: decimalStringSchema.optional(),
      length: decimalStringSchema.optional(),
      width: decimalStringSchema.optional(),
      weight: decimalStringSchema.optional(),
      unit: z.string().min(1).optional(),
    })
    .optional(),
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

export const competitivePricingSchema = observedMetricSchema(
  z.object({
    currency: z.string().length(3).optional(),
    buyBoxPrice: decimalStringSchema.optional(),
    lowestPrice: decimalStringSchema.optional(),
    offerCount: z.number().int().nonnegative().optional(),
    featuredOfferState: z.enum(["PRESENT", "NONE", "UNKNOWN"]),
    completeness: z.enum(["COMPLETE", "PARTIAL"]),
    visibleOfferCount: z.number().int().nonnegative().optional(),
    fbaOfferCount: z.number().int().nonnegative().optional(),
    fbmOfferCount: z.number().int().nonnegative().optional(),
    amazonRetailPresence: z.enum(["PRESENT", "ABSENT", "UNKNOWN"]),
    brandSellerStatus: z.enum(["VERIFIED", "UNVERIFIED", "UNKNOWN"]),
    lowestFbaPrice: decimalStringSchema.optional(),
    lowestFbmPrice: decimalStringSchema.optional(),
    offers: z
      .array(
        z.object({
          sellerId: z.string().min(1).optional(),
          condition: z.string().min(1).optional(),
          fulfillmentChannel: z.enum(["AMAZON", "MERCHANT", "UNKNOWN"]),
          listingPrice: decimalStringSchema.optional(),
          shippingPrice: decimalStringSchema.optional(),
          landedPrice: decimalStringSchema.optional(),
          currency: z.string().length(3).optional(),
          isFeatured: z.boolean().optional(),
          isPrime: z.boolean().optional(),
          membership: z.string().min(1).optional(),
        }),
      )
      .default([]),
  }),
);
export type CompetitivePricing = z.infer<typeof competitivePricingSchema>;

export const feeEstimateSchema = observedMetricSchema(
  z.object({
    totalFee: decimalStringSchema,
    quotedPrice: decimalStringSchema,
    currency: z.string().length(3),
    model: z
      .object({
        fixedFee: decimalStringSchema,
        percentageOfPrice: decimalStringSchema,
        minimumFee: decimalStringSchema.optional(),
      })
      .optional(),
  }),
);
export type FeeEstimate = z.infer<typeof feeEstimateSchema>;

export const feeEstimateRequestSchema = z.object({
  asin: z.string().regex(/^B[A-Z0-9]{9}$/),
  price: decimalStringSchema,
  currency: z.string().length(3),
  fulfillmentChannel: z.enum(["AMAZON", "MERCHANT"]),
  marketplace: marketplaceContextSchema,
  requestId: z.string().min(1),
});
export type FeeEstimateRequest = z.infer<typeof feeEstimateRequestSchema>;

export const restrictionsSchema = observedMetricSchema(
  z.object({
    status: z.enum(["ALLOWED", "REQUIRES_APPROVAL", "RESTRICTED", "UNKNOWN"]),
  }),
);
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
  getHistory(
    asin: string,
    marketplace: MarketplaceContext,
  ): Promise<MarketHistory>;
}

export interface ProviderHealthProvider {
  health(marketplace?: MarketplaceContext): Promise<ProviderHealth>;
}

export interface AiMatchProvider {
  rankCandidates(
    input: readonly ListingCandidate[],
  ): Promise<readonly AiMatchRanking[]>;
}
