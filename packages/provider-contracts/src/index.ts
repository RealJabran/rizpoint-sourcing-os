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
});

export const decimalStringSchema = z.string().regex(/^-?\d+(\.\d+)?$/);

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
  identifiers: z.array(catalogIdentifierSchema),
  provenance: provenanceSchema,
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

export const feeEstimateSchema = observedMetricSchema(
  z.object({
    totalFee: decimalStringSchema,
    currency: z.string().length(3),
  }),
);
export type FeeEstimate = z.infer<typeof feeEstimateSchema>;

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
  ): Promise<readonly CatalogProduct[]>;
  searchByKeywords(keywords: string): Promise<readonly ListingCandidate[]>;
  getItem(asin: string): Promise<CatalogProduct | null>;
}

export interface PricingProvider {
  getCurrentOffers(asin: string): Promise<CurrentOffers>;
}

export interface FeeProvider {
  estimateFees(asin: string): Promise<FeeEstimate>;
}

export interface RestrictionProvider {
  getRestrictions(asin: string, sellerAccountId: string): Promise<Restrictions>;
}

export interface MarketHistoryProvider {
  getHistory(asin: string): Promise<MarketHistory>;
}

export interface AiMatchProvider {
  rankCandidates(
    input: readonly ListingCandidate[],
  ): Promise<readonly AiMatchRanking[]>;
}
