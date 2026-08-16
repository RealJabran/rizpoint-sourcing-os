import { createHash } from "node:crypto";
import { ProviderError } from "@rizpoint/provider-contracts";

const TRANSIENT_RETRY_DELAY_MS = 30_000;
const TRANSIENT_RETRY_JITTER_MS = 7_500;

/**
 * Provider Retry-After is authoritative. When a retryable provider response
 * omits it, spread restart traffic over a small bounded window instead of
 * synchronizing all resumed runs on the same second.
 */
export function providerRetryDeadline(
  retryAfterMs: number | undefined,
  now = Date.now(),
  random = Math.random,
): Date {
  if (retryAfterMs !== undefined) return new Date(now + retryAfterMs);
  return new Date(
    now +
      TRANSIENT_RETRY_DELAY_MS +
      Math.floor(random() * TRANSIENT_RETRY_JITTER_MS),
  );
}

export type EnrichmentMetric =
  "CATALOG" | "PRICING" | "FEES" | "RESTRICTIONS" | "HISTORY";

export type CachedEnrichmentResult = {
  metric: EnrichmentMetric;
  value: unknown;
  primaryAmount?: string;
  quotedPrice?: string;
  currency?: string;
  provider: "AMAZON_SP_API" | "MOCK_AMAZON" | "MOCK_HISTORY";
  observedAt: Date;
  freshnessState: "FRESH" | "STALE" | "EXPIRED" | "UNKNOWN";
  providerReference?: string;
  pricing?: {
    requestHash: string;
    requestInputs: ReturnType<typeof pricingRequestInputs>;
    rawEvidenceReference?: string;
    rawEvidence?: unknown;
    completeness: "COMPLETE" | "PARTIAL" | "UNKNOWN";
    featuredOfferState: "PRESENT" | "ABSENT" | "UNKNOWN";
    featuredPrice?: string;
    featuredCurrency?: string;
    featuredFulfillment?: "AMAZON" | "MERCHANT" | "UNKNOWN";
    featuredSellerId?: string;
    amazonRetailPresence: "PRESENT" | "ABSENT" | "UNKNOWN";
    visibleOfferCount?: number;
    visibleOfferCountCompleteness: "COMPLETE" | "PARTIAL" | "UNKNOWN";
    fbaOfferCount?: number;
    fbaOfferCountCompleteness: "COMPLETE" | "PARTIAL" | "UNKNOWN";
    fbmOfferCount?: number;
    fbmOfferCountCompleteness: "COMPLETE" | "PARTIAL" | "UNKNOWN";
    lowestFbaPrice?: string;
    lowestFbmPrice?: string;
  };
  fee?: {
    requestHash: string;
    requestInputs: ReturnType<typeof feeRequestInputs>;
    rawEvidenceReference?: string;
    rawEvidence?: unknown;
    completeness: "COMPLETE" | "PARTIAL" | "UNKNOWN";
    scenarioSource: "CURRENT_FEATURED_OFFER" | "CONSERVATIVE" | "USER_ENTERED";
    fulfillment: "AMAZON" | "MERCHANT" | "UNKNOWN";
    components: Array<{
      feeType: string;
      parentFeeType?: string;
      currency: string;
      feeAmount: string;
      promotionAmount?: string;
      taxAmount?: string;
      finalFee: string;
    }>;
  };
  restrictions?: {
    requestHash: string;
    requestInputs: ReturnType<typeof restrictionRequestInputs>;
    rawEvidenceReference?: string;
    rawEvidence?: unknown;
    completeness: "COMPLETE" | "PARTIAL" | "UNKNOWN";
    state:
      | "ELIGIBLE"
      | "RESTRICTED"
      | "APPROVAL_REQUIRED"
      | "INCOMPLETE"
      | "UNAUTHORIZED"
      | "THROTTLED"
      | "UNKNOWN";
    reasonCodes: string[];
    reasons: unknown[];
    conditionType?: string;
  };
};

export function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function pricingRequestInputs(asin: string, marketplaceId: string) {
  return {
    operation: "getCompetitiveSummary",
    asin,
    marketplaceId,
    includedData: ["featuredBuyingOptions", "lowestPricedOffers"],
    lowestPricedOffersInputs: [{ itemCondition: "New", offerType: "Consumer" }],
  };
}

export function feeRequestInputs(input: {
  asin: string;
  marketplaceId: string;
  price: string;
  listingPrice?: string;
  shippingPrice: string;
  currency: string;
  fulfillmentChannel: "AMAZON" | "MERCHANT";
  scenarioSource: "CURRENT_FEATURED_OFFER" | "CONSERVATIVE" | "USER_ENTERED";
}) {
  return { operation: "getMyFeesEstimateForASIN", ...input };
}

export function restrictionRequestInputs(asin: string, marketplaceId: string) {
  return {
    operation: "getListingsRestrictions",
    asin,
    marketplaceId,
    conditionType: "new_new",
  };
}

export function providerError(error: unknown) {
  if (!(error instanceof ProviderError))
    return { code: "UNKNOWN", status: "RETRYABLE_ERROR" as const };
  return {
    code: error.code,
    status:
      error.code === "THROTTLED"
        ? ("THROTTLED" as const)
        : ["TRANSIENT", "PROVIDER_OUTAGE"].includes(error.code)
          ? ("RETRYABLE_ERROR" as const)
          : ("PERMANENT_ERROR" as const),
    retryAt:
      error.options.retryAfterMs === undefined
        ? undefined
        : providerRetryDeadline(error.options.retryAfterMs),
    httpStatus: error.options.httpStatus,
    providerRequestId: error.options.providerRequestId,
  };
}

export function observationFailureStatus(
  detail: ReturnType<typeof providerError>,
) {
  return detail.code === "UNAUTHORIZED" || detail.code === "FORBIDDEN"
    ? ("UNAUTHORIZED" as const)
    : detail.status === "THROTTLED"
      ? ("THROTTLED" as const)
      : detail.status === "RETRYABLE_ERROR"
        ? ("RETRYABLE_FAILURE" as const)
        : detail.code === "NOT_FOUND"
          ? ("UNAVAILABLE" as const)
          : ("TERMINAL_FAILURE" as const);
}

export function restrictionFailureState(
  detail: ReturnType<typeof providerError>,
) {
  return detail.code === "UNAUTHORIZED" || detail.code === "FORBIDDEN"
    ? ("UNAUTHORIZED" as const)
    : detail.status === "THROTTLED"
      ? ("THROTTLED" as const)
      : ("UNKNOWN" as const);
}

export function operationForMetric(metric: EnrichmentMetric) {
  return metric === "PRICING"
    ? "getCompetitiveSummary"
    : metric === "FEES"
      ? "getMyFeesEstimateForASIN"
      : metric === "RESTRICTIONS"
        ? "getListingsRestrictions"
        : metric;
}
