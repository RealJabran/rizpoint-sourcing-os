import type {
  ProviderCapability,
  ProviderFreshnessPolicy,
  ProviderOperationalState,
  ProviderUnavailableReason,
} from "./index.js";

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

/** Product defaults, not claims about provider service levels. A licensed
 * adapter may use a stricter policy when its contract or data class requires it. */
export const DEFAULT_PROVIDER_FRESHNESS_POLICIES: Readonly<
  Record<ProviderCapability, ProviderFreshnessPolicy>
> = {
  CATALOG: {
    capability: "CATALOG",
    freshForSeconds: DAY,
    staleWhileRevalidateSeconds: 6 * HOUR,
    retainForSeconds: 30 * DAY,
  },
  COMPETITIVE_OFFERS: {
    capability: "COMPETITIVE_OFFERS",
    freshForSeconds: 15 * 60,
    staleWhileRevalidateSeconds: 45 * 60,
    retainForSeconds: 30 * DAY,
  },
  FEES: {
    capability: "FEES",
    freshForSeconds: 6 * HOUR,
    staleWhileRevalidateSeconds: 18 * HOUR,
    retainForSeconds: 30 * DAY,
  },
  RESTRICTIONS: {
    capability: "RESTRICTIONS",
    freshForSeconds: DAY,
    staleWhileRevalidateSeconds: DAY,
    retainForSeconds: 30 * DAY,
  },
  MARKET_HISTORY: {
    capability: "MARKET_HISTORY",
    freshForSeconds: 6 * HOUR,
    staleWhileRevalidateSeconds: 18 * HOUR,
    retainForSeconds: 30 * DAY,
  },
  KEYWORD_DISCOVERY: {
    capability: "KEYWORD_DISCOVERY",
    freshForSeconds: 7 * DAY,
    staleWhileRevalidateSeconds: 7 * DAY,
    retainForSeconds: 90 * DAY,
  },
  REVERSE_ASIN: {
    capability: "REVERSE_ASIN",
    freshForSeconds: 7 * DAY,
    staleWhileRevalidateSeconds: 7 * DAY,
    retainForSeconds: 90 * DAY,
  },
  SEARCH_RANK: {
    capability: "SEARCH_RANK",
    freshForSeconds: DAY,
    staleWhileRevalidateSeconds: DAY,
    retainForSeconds: 90 * DAY,
  },
  CATEGORY_INTELLIGENCE: {
    capability: "CATEGORY_INTELLIGENCE",
    freshForSeconds: 7 * DAY,
    staleWhileRevalidateSeconds: 7 * DAY,
    retainForSeconds: 90 * DAY,
  },
  BRAND_INTELLIGENCE: {
    capability: "BRAND_INTELLIGENCE",
    freshForSeconds: 7 * DAY,
    staleWhileRevalidateSeconds: 7 * DAY,
    retainForSeconds: 90 * DAY,
  },
  SELLER_INTELLIGENCE: {
    capability: "SELLER_INTELLIGENCE",
    freshForSeconds: DAY,
    staleWhileRevalidateSeconds: DAY,
    retainForSeconds: 90 * DAY,
  },
  AD_INTELLIGENCE: {
    capability: "AD_INTELLIGENCE",
    freshForSeconds: DAY,
    staleWhileRevalidateSeconds: DAY,
    retainForSeconds: 90 * DAY,
  },
  REVIEW_INTELLIGENCE: {
    capability: "REVIEW_INTELLIGENCE",
    freshForSeconds: 7 * DAY,
    staleWhileRevalidateSeconds: 7 * DAY,
    retainForSeconds: 90 * DAY,
  },
};

export function providerFailureState(errorCode: string): {
  state: ProviderOperationalState;
  reason: ProviderUnavailableReason;
} {
  switch (errorCode) {
    case "UNAUTHORIZED":
    case "FORBIDDEN":
      return {
        state: "UNAUTHORIZED",
        reason: "CONNECTION_NOT_AUTHORIZED",
      };
    case "THROTTLED":
      return { state: "THROTTLED", reason: "PROVIDER_THROTTLED" };
    case "QUOTA_EXHAUSTED":
      return {
        state: "QUOTA_EXHAUSTED",
        reason: "QUOTA_WINDOW_EXHAUSTED",
      };
    case "INVALID_RESPONSE":
      return { state: "PARTIAL", reason: "PARTIAL_RESPONSE" };
    default:
      return { state: "UNAVAILABLE", reason: "PROVIDER_OUTAGE" };
  }
}
