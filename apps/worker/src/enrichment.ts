import {
  completeEnrichmentRun,
  getEnrichmentRunForProcessing,
  persistEnrichmentItem,
  recordProviderCallAttempt,
  scheduleEnrichmentRetry,
} from "@rizpoint/database";
import { ProviderError } from "@rizpoint/provider-contracts";
import { createEnrichmentProvider } from "./enrichment-provider.js";
import {
  feeRequestInputs,
  observationFailureStatus,
  operationForMetric,
  pricingRequestInputs,
  providerError,
  providerRetryDeadline,
  restrictionFailureState,
  restrictionRequestInputs,
  stableHash,
  type CachedEnrichmentResult as CachedResult,
  type EnrichmentMetric as Metric,
} from "./enrichment-policy.js";
import { providerCalls } from "./observability.js";
import {
  accessProviderData,
  providerDataCacheState,
} from "./provider-data-access.js";

export { providerRetryDeadline } from "./enrichment-policy.js";

const FRESH_FOR_MS = 15 * 60_000;

function capabilityForMetric(metric: Metric) {
  return metric === "CATALOG"
    ? ("CATALOG" as const)
    : metric === "PRICING"
      ? ("COMPETITIVE_OFFERS" as const)
      : metric === "FEES"
        ? ("FEES" as const)
        : metric === "RESTRICTIONS"
          ? ("RESTRICTIONS" as const)
          : ("MARKET_HISTORY" as const);
}

function cacheableEnrichmentResult(result: CachedResult): CachedResult {
  const copy = structuredClone(result);
  if (
    copy.value &&
    typeof copy.value === "object" &&
    !Array.isArray(copy.value)
  )
    delete (copy.value as { rawProviderObservation?: unknown })
      .rawProviderObservation;
  if (copy.pricing) delete copy.pricing.rawEvidence;
  if (copy.fee) delete copy.fee.rawEvidence;
  if (copy.restrictions) delete copy.restrictions.rawEvidence;
  return copy;
}

function parseCachedEnrichmentResult(value: unknown): CachedResult {
  if (!value || typeof value !== "object")
    throw new ProviderError("INVALID_RESPONSE");
  const candidate = value as Omit<CachedResult, "observedAt" | "freshUntil"> & {
    observedAt: string | Date;
    freshUntil?: string | Date;
  };
  if (
    !["CATALOG", "PRICING", "FEES", "RESTRICTIONS", "HISTORY"].includes(
      candidate.metric,
    )
  )
    throw new ProviderError("INVALID_RESPONSE");
  const observedAt = new Date(candidate.observedAt);
  const freshUntil = candidate.freshUntil
    ? new Date(candidate.freshUntil)
    : undefined;
  if (
    Number.isNaN(observedAt.getTime()) ||
    (freshUntil && Number.isNaN(freshUntil.getTime()))
  )
    throw new ProviderError("INVALID_RESPONSE");
  return {
    ...candidate,
    observedAt,
    ...(freshUntil ? { freshUntil } : {}),
  } as CachedResult;
}

function resultCompleteness(result: CachedResult) {
  if (result.pricing) return result.pricing.completeness;
  if (result.fee) return result.fee.completeness;
  if (result.restrictions) return result.restrictions.completeness;
  const value = result.value as
    | { value?: { completeness?: "COMPLETE" | "PARTIAL" | "UNKNOWN" } }
    | undefined;
  return value?.value?.completeness ?? "UNKNOWN";
}

/** Fixture-first, deterministic enrichment. Cache is run-scoped so duplicate ASIN rows do not duplicate provider calls. */
export async function processEnrichment(scanJobId: string) {
  const run = await getEnrichmentRunForProcessing(scanJobId);
  if (!run) return;
  let bundle: ReturnType<typeof createEnrichmentProvider>;
  try {
    bundle = createEnrichmentProvider(run.providerConnection);
  } catch (error) {
    const detail = providerError(error);
    const provider = run.providerConnection?.provider ?? "AMAZON_SP_API";
    for (const item of run.items) {
      if (item.status === "COMPLETED") continue;
      const missingMetrics: string[] = [];
      for (const metric of [
        "CATALOG",
        "PRICING",
        "FEES",
        "RESTRICTIONS",
        "HISTORY",
      ] as const) {
        missingMetrics.push(`${metric}_${detail.code}`);
        const marketplaceId =
          run.providerConnection?.marketplaceId ?? "UNKNOWN";
        const pricingInputs = pricingRequestInputs(item.asin, marketplaceId);
        await recordProviderCallAttempt({
          organizationId: run.organizationId,
          enrichmentRunId: run.id,
          provider,
          operation: operationForMetric(metric),
          requestKey:
            metric === "PRICING"
              ? stableHash(pricingInputs)
              : `${marketplaceId}:${item.asin}`,
          attempt: run.attemptCount,
          status: detail.status,
          errorCode: detail.code,
        });
        providerCalls.inc({
          operation: metric,
          outcome: detail.status.toLowerCase(),
        });
      }
      await persistEnrichmentItem({
        enrichmentItemId: item.id,
        observations: [
          {
            metricType: "PRICING",
            provider,
            observedAt: new Date(),
            freshUntil: new Date(),
            freshnessState: "UNKNOWN",
            marketplaceId: run.providerConnection?.marketplaceId ?? "UNKNOWN",
            payload: { errorCode: detail.code },
            operation: "getCompetitiveSummary",
            observationStatus:
              detail.code === "UNAUTHORIZED" || detail.code === "FORBIDDEN"
                ? "UNAUTHORIZED"
                : detail.status === "THROTTLED"
                  ? "THROTTLED"
                  : detail.status === "RETRYABLE_ERROR"
                    ? "RETRYABLE_FAILURE"
                    : "TERMINAL_FAILURE",
            requestHash: stableHash(
              pricingRequestInputs(
                item.asin,
                run.providerConnection?.marketplaceId ?? "UNKNOWN",
              ),
            ),
            requestInputs: pricingRequestInputs(
              item.asin,
              run.providerConnection?.marketplaceId ?? "UNKNOWN",
            ),
            completeness: "UNKNOWN",
            asin: item.asin,
            featuredOfferState: "UNKNOWN",
            amazonRetailPresence: "UNKNOWN",
            visibleOfferCountCompleteness: "UNKNOWN",
            fbaOfferCountCompleteness: "UNKNOWN",
            fbmOfferCountCompleteness: "UNKNOWN",
          },
          {
            metricType: "FEES",
            provider,
            observedAt: new Date(),
            freshUntil: new Date(),
            freshnessState: "UNKNOWN",
            marketplaceId: run.providerConnection?.marketplaceId ?? "UNKNOWN",
            payload: { errorCode: detail.code },
            operation: "getMyFeesEstimateForASIN",
            observationStatus: observationFailureStatus(detail),
            requestHash: stableHash({
              operation: "getMyFeesEstimateForASIN",
              asin: item.asin,
              marketplaceId: run.providerConnection?.marketplaceId ?? "UNKNOWN",
            }),
            requestInputs: {
              operation: "getMyFeesEstimateForASIN",
              asin: item.asin,
              marketplaceId: run.providerConnection?.marketplaceId ?? "UNKNOWN",
            },
            completeness: "UNKNOWN",
            asin: item.asin,
            feeScenarioSource: "CURRENT_FEATURED_OFFER",
            feeFulfillment: "UNKNOWN",
          },
          {
            metricType: "RESTRICTIONS",
            provider,
            observedAt: new Date(),
            freshUntil: new Date(),
            freshnessState: "UNKNOWN",
            marketplaceId: run.providerConnection?.marketplaceId ?? "UNKNOWN",
            payload: { errorCode: detail.code },
            operation: "getListingsRestrictions",
            observationStatus: observationFailureStatus(detail),
            requestHash: stableHash(
              restrictionRequestInputs(
                item.asin,
                run.providerConnection?.marketplaceId ?? "UNKNOWN",
              ),
            ),
            requestInputs: restrictionRequestInputs(
              item.asin,
              run.providerConnection?.marketplaceId ?? "UNKNOWN",
            ),
            completeness: "UNKNOWN",
            asin: item.asin,
            restrictionState: restrictionFailureState(detail),
            restrictionReasonCodes: [],
            restrictionReasons: [],
            restrictionConditionType: "new_new",
          },
        ],
        missingMetrics,
        errorCode: detail.code,
      });
    }
    await completeEnrichmentRun(run.id);
    return;
  }
  const { provider, providerKind, marketplace } = bundle;
  const cache = new Map<string, Promise<CachedResult>>();
  const usablePricingObservation = (observation: {
    metricType: string;
    observationStatus: string;
    freshUntil?: Date;
  }) =>
    observation.metricType === "PRICING" &&
    ["SUCCESS", "PARTIAL"].includes(observation.observationStatus) &&
    observation.freshUntil instanceof Date &&
    observation.freshUntil.getTime() > Date.now();
  const persistedPricing = new Map<
    string,
    (typeof run.items)[number]["observations"][number]
  >();
  for (const item of run.items) {
    const current = item.observations
      .filter(usablePricingObservation)
      .sort(
        (left, right) => right.observedAt.getTime() - left.observedAt.getTime(),
      )[0];
    const existing = persistedPricing.get(item.asin);
    if (!current) continue;
    if (!existing || current.observedAt > existing.observedAt)
      persistedPricing.set(item.asin, current);
  }
  const pricingPrefetch = new Map<string, Promise<unknown>>();
  if (provider.getCompetitivePricingBatch) {
    const candidates = [
      ...new Set(
        run.items
          .filter(
            (item) =>
              item.status !== "COMPLETED" &&
              !item.observations.some(usablePricingObservation),
          )
          .map((item) => item.asin),
      ),
    ];
    const pendingAsins = run.forceRefresh
      ? candidates
      : (
          await Promise.all(
            candidates.map(async (asin) => ({
              asin,
              state: await providerDataCacheState({
                organizationId: run.organizationId,
                providerKey: bundle.providerKey,
                marketplaceId: marketplace.marketplaceId,
                capability: "COMPETITIVE_OFFERS",
                operation: "getCompetitiveSummary",
                request: pricingRequestInputs(asin, marketplace.marketplaceId),
              }),
            })),
          )
        )
          .filter(({ state }) => state.outcome !== "FRESH_HIT")
          .map(({ asin }) => asin);
    let previousBatch: Promise<unknown> = Promise.resolve();
    for (let offset = 0; offset < pendingAsins.length; offset += 20) {
      const batchAsins = pendingAsins.slice(offset, offset + 20);
      const batch = previousBatch.then(() =>
        provider.getCompetitivePricingBatch!(batchAsins, marketplace),
      );
      previousBatch = batch;
      for (const asin of batchAsins) {
        pricingPrefetch.set(
          asin,
          batch.then((results) => {
            const result = results.find((candidate) => candidate.asin === asin);
            if (!result) throw new ProviderError("INVALID_RESPONSE");
            if (result.status === "ERROR")
              throw new ProviderError(result.error.code, result.error);
            return result.pricing;
          }),
        );
      }
    }
  }
  let retryAt: Date | undefined;
  const call = (asin: string, metric: Metric): Promise<CachedResult> => {
    const key = `${marketplace.marketplaceId}:${asin}:${metric}`;
    const existing = cache.get(key);
    if (existing) return existing;
    const stored = metric === "PRICING" ? persistedPricing.get(asin) : null;
    if (stored) {
      const task = Promise.resolve({
        metric,
        value: stored.payload,
        observedAt: stored.observedAt,
        freshnessState: stored.freshnessState,
        provider: stored.provider,
        ...(stored.providerReference
          ? { providerReference: stored.providerReference }
          : {}),
        ...(stored.primaryAmount
          ? { primaryAmount: stored.primaryAmount.toString() }
          : {}),
        ...(stored.currency ? { currency: stored.currency } : {}),
      } satisfies CachedResult);
      cache.set(key, task);
      return task;
    }
    const task = (async () => {
      let preparedFeeRequest:
        Parameters<typeof provider.estimateFees>[0] | undefined;
      if (metric === "FEES") {
        const pricing = await call(asin, "PRICING");
        const offer = (
          pricing.value as {
            value?: {
              featuredOfferState?: string;
              featuredOffer?: {
                listingPrice?: string;
                shippingPrice?: string;
                landedPrice?: string;
                currency?: string;
                fulfillmentChannel?: string;
              };
            };
          }
        ).value;
        const featured = offer?.featuredOffer;
        if (
          offer?.featuredOfferState !== "PRESENT" ||
          !featured?.landedPrice ||
          !featured.currency ||
          !["AMAZON", "MERCHANT"].includes(featured.fulfillmentChannel ?? "")
        )
          throw new ProviderError("NOT_FOUND");
        preparedFeeRequest = {
          asin,
          marketplace,
          fulfillmentChannel: featured.fulfillmentChannel as
            "AMAZON" | "MERCHANT",
          price: featured.landedPrice,
          ...(featured.listingPrice
            ? { listingPrice: featured.listingPrice }
            : {}),
          shippingPrice: featured.shippingPrice ?? "0",
          currency: featured.currency,
          scenarioSource: "CURRENT_FEATURED_OFFER",
          requestId: `${run.id}:${asin}:CURRENT_FEATURED_OFFER:${featured.landedPrice}`,
        };
      }
      const requestIdentity =
        metric === "PRICING"
          ? pricingRequestInputs(asin, marketplace.marketplaceId)
          : metric === "FEES" && preparedFeeRequest
            ? feeRequestInputs({
                asin,
                marketplaceId: marketplace.marketplaceId,
                price: preparedFeeRequest.price,
                ...(preparedFeeRequest.listingPrice
                  ? { listingPrice: preparedFeeRequest.listingPrice }
                  : {}),
                shippingPrice: preparedFeeRequest.shippingPrice,
                currency: preparedFeeRequest.currency,
                fulfillmentChannel: preparedFeeRequest.fulfillmentChannel,
                scenarioSource: preparedFeeRequest.scenarioSource,
              })
            : metric === "RESTRICTIONS"
              ? restrictionRequestInputs(asin, marketplace.marketplaceId)
              : {
                  operation: operationForMetric(metric),
                  asin,
                  marketplaceId: marketplace.marketplaceId,
                };
      const fetchResult = async (): Promise<CachedResult> => {
        const value =
          metric === "CATALOG"
            ? await provider.getItem(asin, marketplace)
            : metric === "PRICING"
              ? await (pricingPrefetch.get(asin) ??
                  provider.getCompetitivePricing(asin, marketplace))
              : metric === "FEES"
                ? await provider.estimateFees(preparedFeeRequest!)
                : metric === "RESTRICTIONS"
                  ? await provider.getRestrictions(asin, marketplace)
                  : await provider.getHistory(asin, marketplace);
        if (value == null) throw new ProviderError("NOT_FOUND");
        const observed = value as {
          provenance?: {
            providerReference?: string;
            observedAt?: string;
            freshnessState?: "FRESH" | "STALE" | "EXPIRED" | "UNKNOWN";
          };
          value?:
            | {
                lowestPrice?: string;
                totalFee?: string;
                quotedPrice?: string;
                listingPrice?: string;
                shippingPrice?: string;
                currency?: string;
                operation?: string;
                asin?: string;
                marketplaceId?: string;
                fulfillmentChannel?: "AMAZON" | "MERCHANT";
                scenarioSource?:
                  "CURRENT_FEATURED_OFFER" | "CONSERVATIVE" | "USER_ENTERED";
                completeness?: "COMPLETE" | "PARTIAL" | "UNKNOWN";
                components?: Array<{
                  feeType: string;
                  parentFeeType?: string;
                  currency: string;
                  feeAmount: string;
                  promotion?: string;
                  tax?: string;
                  finalFee: string;
                }>;
                state?:
                  | "ELIGIBLE"
                  | "RESTRICTED"
                  | "APPROVAL_REQUIRED"
                  | "INCOMPLETE"
                  | "UNAUTHORIZED"
                  | "THROTTLED"
                  | "UNKNOWN";
                reasons?: Array<{ code?: string }>;
                conditionType?: string;
              }
            | Array<{ currency?: string }>;
          rawProviderObservation?: unknown;
        };
        const observedAt = new Date(observed.provenance?.observedAt ?? "");
        if (Number.isNaN(observedAt.getTime())) {
          throw new ProviderError("INVALID_RESPONSE");
        }
        const amount =
          metric === "PRICING"
            ? (
                observed.value as
                  { featuredOffer?: { landedPrice?: string } } | undefined
              )?.featuredOffer?.landedPrice
            : metric === "FEES"
              ? (observed.value as { totalFee?: string } | undefined)?.totalFee
              : undefined;
        const currency =
          metric === "PRICING" || metric === "FEES"
            ? (observed.value as { currency?: string } | undefined)?.currency
            : metric === "HISTORY"
              ? (
                  observed.value as Array<{ currency?: string }> | undefined
                )?.[0]?.currency
              : undefined;
        const pricingValue =
          metric === "PRICING"
            ? (observed.value as
                | {
                    completeness: "COMPLETE" | "PARTIAL" | "UNKNOWN";
                    featuredOfferState: "PRESENT" | "ABSENT" | "UNKNOWN";
                    featuredOffer?: {
                      landedPrice?: string;
                      currency?: string;
                      fulfillmentChannel: "AMAZON" | "MERCHANT" | "UNKNOWN";
                      sellerId?: string;
                    };
                    amazonRetailPresence: "PRESENT" | "ABSENT" | "UNKNOWN";
                    totalVisibleOffers: {
                      value?: number;
                      completeness: "COMPLETE" | "PARTIAL" | "UNKNOWN";
                    };
                    fbaVisibleOffers: {
                      value?: number;
                      completeness: "COMPLETE" | "PARTIAL" | "UNKNOWN";
                    };
                    fbmVisibleOffers: {
                      value?: number;
                      completeness: "COMPLETE" | "PARTIAL" | "UNKNOWN";
                    };
                    lowestFbaPrice?: string;
                    lowestFbmPrice?: string;
                  }
                | undefined)
            : undefined;
        const requestInputs = pricingRequestInputs(
          asin,
          marketplace.marketplaceId,
        );
        const feeValue =
          metric === "FEES"
            ? (observed.value as
                | {
                    quotedPrice: string;
                    listingPrice: string;
                    shippingPrice: string;
                    currency: string;
                    fulfillmentChannel: "AMAZON" | "MERCHANT";
                    scenarioSource:
                      | "CURRENT_FEATURED_OFFER"
                      | "CONSERVATIVE"
                      | "USER_ENTERED";
                    completeness: "COMPLETE" | "PARTIAL" | "UNKNOWN";
                    components: Array<{
                      feeType: string;
                      parentFeeType?: string;
                      currency: string;
                      feeAmount: string;
                      promotion?: string;
                      tax?: string;
                      finalFee: string;
                    }>;
                  }
                | undefined)
            : undefined;
        const feeInputs = feeValue
          ? feeRequestInputs({
              asin,
              marketplaceId: marketplace.marketplaceId,
              price: feeValue.quotedPrice,
              listingPrice: feeValue.listingPrice,
              shippingPrice: feeValue.shippingPrice,
              currency: feeValue.currency,
              fulfillmentChannel: feeValue.fulfillmentChannel,
              scenarioSource: feeValue.scenarioSource,
            })
          : undefined;
        const restrictionValue =
          metric === "RESTRICTIONS"
            ? (observed.value as
                | {
                    state:
                      | "ELIGIBLE"
                      | "RESTRICTED"
                      | "APPROVAL_REQUIRED"
                      | "INCOMPLETE"
                      | "UNAUTHORIZED"
                      | "THROTTLED"
                      | "UNKNOWN";
                    completeness: "COMPLETE" | "PARTIAL" | "UNKNOWN";
                    reasons: Array<{ code?: string }>;
                    conditionType?: string;
                  }
                | undefined)
            : undefined;
        const restrictionInputs = restrictionValue
          ? restrictionRequestInputs(asin, marketplace.marketplaceId)
          : undefined;
        return {
          metric,
          value,
          observedAt,
          freshnessState: observed.provenance?.freshnessState ?? "UNKNOWN",
          provider: (metric === "HISTORY" && providerKind === "MOCK_AMAZON"
            ? "MOCK_HISTORY"
            : providerKind) as CachedResult["provider"],
          ...(observed.provenance?.providerReference
            ? { providerReference: observed.provenance.providerReference }
            : {}),
          ...(amount ? { primaryAmount: amount } : {}),
          ...(metric === "FEES" &&
          (observed.value as { quotedPrice?: string } | undefined)?.quotedPrice
            ? {
                quotedPrice: (observed.value as { quotedPrice: string })
                  .quotedPrice,
              }
            : {}),
          ...(currency ? { currency } : {}),
          ...(pricingValue
            ? {
                pricing: {
                  requestHash: stableHash(requestInputs),
                  requestInputs,
                  ...(observed.rawProviderObservation !== undefined
                    ? {
                        rawEvidence: observed.rawProviderObservation,
                        rawEvidenceReference: stableHash(
                          observed.rawProviderObservation,
                        ),
                      }
                    : {}),
                  completeness: pricingValue.completeness,
                  featuredOfferState: pricingValue.featuredOfferState,
                  ...(pricingValue.featuredOffer?.landedPrice
                    ? { featuredPrice: pricingValue.featuredOffer.landedPrice }
                    : {}),
                  ...(pricingValue.featuredOffer?.currency
                    ? { featuredCurrency: pricingValue.featuredOffer.currency }
                    : {}),
                  ...(pricingValue.featuredOffer
                    ? {
                        featuredFulfillment:
                          pricingValue.featuredOffer.fulfillmentChannel,
                      }
                    : {}),
                  ...(pricingValue.featuredOffer?.sellerId
                    ? { featuredSellerId: pricingValue.featuredOffer.sellerId }
                    : {}),
                  amazonRetailPresence: pricingValue.amazonRetailPresence,
                  ...(pricingValue.totalVisibleOffers.value !== undefined
                    ? {
                        visibleOfferCount:
                          pricingValue.totalVisibleOffers.value,
                      }
                    : {}),
                  visibleOfferCountCompleteness:
                    pricingValue.totalVisibleOffers.completeness,
                  ...(pricingValue.fbaVisibleOffers.value !== undefined
                    ? { fbaOfferCount: pricingValue.fbaVisibleOffers.value }
                    : {}),
                  fbaOfferCountCompleteness:
                    pricingValue.fbaVisibleOffers.completeness,
                  ...(pricingValue.fbmVisibleOffers.value !== undefined
                    ? { fbmOfferCount: pricingValue.fbmVisibleOffers.value }
                    : {}),
                  fbmOfferCountCompleteness:
                    pricingValue.fbmVisibleOffers.completeness,
                  ...(pricingValue.lowestFbaPrice
                    ? { lowestFbaPrice: pricingValue.lowestFbaPrice }
                    : {}),
                  ...(pricingValue.lowestFbmPrice
                    ? { lowestFbmPrice: pricingValue.lowestFbmPrice }
                    : {}),
                },
              }
            : {}),
          ...(feeValue && feeInputs
            ? {
                fee: {
                  requestHash: stableHash(feeInputs),
                  requestInputs: feeInputs,
                  ...(observed.rawProviderObservation !== undefined
                    ? {
                        rawEvidence: observed.rawProviderObservation,
                        rawEvidenceReference: stableHash(
                          observed.rawProviderObservation,
                        ),
                      }
                    : {}),
                  completeness: feeValue.completeness,
                  scenarioSource: feeValue.scenarioSource,
                  fulfillment: feeValue.fulfillmentChannel,
                  components: feeValue.components.map((component) => ({
                    feeType: component.feeType,
                    currency: component.currency,
                    feeAmount: component.feeAmount,
                    finalFee: component.finalFee,
                    ...(component.parentFeeType
                      ? { parentFeeType: component.parentFeeType }
                      : {}),
                    ...(component.promotion
                      ? { promotionAmount: component.promotion }
                      : {}),
                    ...(component.tax ? { taxAmount: component.tax } : {}),
                  })),
                },
              }
            : {}),
          ...(restrictionValue && restrictionInputs
            ? {
                restrictions: {
                  requestHash: stableHash(restrictionInputs),
                  requestInputs: restrictionInputs,
                  ...(observed.rawProviderObservation !== undefined
                    ? {
                        rawEvidence: observed.rawProviderObservation,
                        rawEvidenceReference: stableHash(
                          observed.rawProviderObservation,
                        ),
                      }
                    : {}),
                  completeness: restrictionValue.completeness,
                  state: restrictionValue.state,
                  reasonCodes: restrictionValue.reasons.flatMap((reason) =>
                    reason.code ? [reason.code] : [],
                  ),
                  reasons: restrictionValue.reasons,
                  ...(restrictionValue.conditionType
                    ? { conditionType: restrictionValue.conditionType }
                    : {}),
                },
              }
            : {}),
        };
      };
      const accessed = await accessProviderData({
        organizationId: run.organizationId,
        providerKey: bundle.providerKey,
        marketplaceId: marketplace.marketplaceId,
        capability: capabilityForMetric(metric),
        operation: operationForMetric(metric),
        request: requestIdentity,
        mode: bundle.mode,
        forceRefresh: run.forceRefresh,
        parse: parseCachedEnrichmentResult,
        fetch: async () => {
          const result = await fetchResult();
          return {
            projection: result,
            cacheProjection: cacheableEnrichmentResult(result),
            observedAt: result.observedAt,
            completeness: resultCompleteness(result),
          };
        },
      });
      return {
        ...accessed.projection,
        observedAt: accessed.observedAt,
        freshUntil: accessed.freshUntil,
        freshnessState:
          accessed.source === "PERSISTED_STALE"
            ? ("STALE" as const)
            : ("FRESH" as const),
      } satisfies CachedResult;
    })();
    cache.set(key, task);
    return task;
  };
  for (const item of run.items) {
    if (item.status === "COMPLETED") continue;
    const observations: Parameters<
      typeof persistEnrichmentItem
    >[0]["observations"] = [];
    const missingMetrics: string[] = [];
    let lastErrorCode: string | undefined;
    for (const metric of [
      "CATALOG",
      "PRICING",
      "FEES",
      "RESTRICTIONS",
      "HISTORY",
    ] as const) {
      if (
        !run.forceRefresh &&
        item.observations.some(
          (observation) =>
            observation.metricType === metric &&
            ["SUCCESS", "PARTIAL"].includes(observation.observationStatus) &&
            observation.freshUntil.getTime() > Date.now(),
        )
      )
        continue;
      try {
        const result = await call(item.asin, metric);
        if (metric === "PRICING" && result.pricing?.completeness !== "COMPLETE")
          missingMetrics.push("PRICING_PARTIAL_RESPONSE");
        if (metric === "FEES" && result.fee?.completeness !== "COMPLETE")
          missingMetrics.push("FEES_PARTIAL_RESPONSE");
        if (
          metric === "RESTRICTIONS" &&
          result.restrictions?.completeness !== "COMPLETE"
        )
          missingMetrics.push("RESTRICTIONS_PARTIAL_RESPONSE");
        await recordProviderCallAttempt({
          organizationId: run.organizationId,
          enrichmentRunId: run.id,
          provider: result.provider,
          operation: operationForMetric(metric),
          requestKey:
            metric === "PRICING"
              ? stableHash(
                  pricingRequestInputs(item.asin, marketplace.marketplaceId),
                )
              : metric === "FEES" && result.fee
                ? result.fee.requestHash
                : metric === "RESTRICTIONS" && result.restrictions
                  ? result.restrictions.requestHash
                  : `${marketplace.marketplaceId}:${item.asin}`,
          attempt: run.attemptCount,
          status: "SUCCESS",
        });
        providerCalls.inc({ operation: metric, outcome: "success" });
        observations.push({
          metricType: metric,
          provider: result.provider,
          observedAt: result.observedAt,
          freshUntil:
            result.freshUntil ??
            new Date(result.observedAt.getTime() + FRESH_FOR_MS),
          freshnessState: result.freshnessState,
          marketplaceId: marketplace.marketplaceId,
          payload: JSON.parse(JSON.stringify(result.value)),
          ...(result.providerReference
            ? { providerReference: result.providerReference }
            : {}),
          ...(result.primaryAmount
            ? { primaryAmount: result.primaryAmount }
            : {}),
          ...(result.quotedPrice ? { quotedPrice: result.quotedPrice } : {}),
          ...(result.currency ? { currency: result.currency } : {}),
          ...(result.pricing
            ? {
                operation: "getCompetitiveSummary",
                observationStatus:
                  result.pricing.completeness === "COMPLETE"
                    ? ("SUCCESS" as const)
                    : ("PARTIAL" as const),
                requestHash: result.pricing.requestHash,
                requestInputs: result.pricing.requestInputs,
                completeness: result.pricing.completeness,
                ...(result.pricing.rawEvidenceReference
                  ? {
                      rawEvidenceReference: result.pricing.rawEvidenceReference,
                    }
                  : {}),
                ...(result.pricing.rawEvidence !== undefined
                  ? {
                      rawEvidence: JSON.parse(
                        JSON.stringify(result.pricing.rawEvidence),
                      ),
                    }
                  : {}),
                asin: item.asin,
                featuredOfferState: result.pricing.featuredOfferState,
                ...(result.pricing.featuredPrice
                  ? { featuredPrice: result.pricing.featuredPrice }
                  : {}),
                ...(result.pricing.featuredCurrency
                  ? { featuredCurrency: result.pricing.featuredCurrency }
                  : {}),
                ...(result.pricing.featuredFulfillment
                  ? {
                      featuredFulfillment: result.pricing.featuredFulfillment,
                    }
                  : {}),
                ...(result.pricing.featuredSellerId
                  ? { featuredSellerId: result.pricing.featuredSellerId }
                  : {}),
                amazonRetailPresence: result.pricing.amazonRetailPresence,
                ...(result.pricing.visibleOfferCount !== undefined
                  ? { visibleOfferCount: result.pricing.visibleOfferCount }
                  : {}),
                visibleOfferCountCompleteness:
                  result.pricing.visibleOfferCountCompleteness,
                ...(result.pricing.fbaOfferCount !== undefined
                  ? { fbaOfferCount: result.pricing.fbaOfferCount }
                  : {}),
                fbaOfferCountCompleteness:
                  result.pricing.fbaOfferCountCompleteness,
                ...(result.pricing.fbmOfferCount !== undefined
                  ? { fbmOfferCount: result.pricing.fbmOfferCount }
                  : {}),
                fbmOfferCountCompleteness:
                  result.pricing.fbmOfferCountCompleteness,
                ...(result.pricing.lowestFbaPrice
                  ? { lowestFbaPrice: result.pricing.lowestFbaPrice }
                  : {}),
                ...(result.pricing.lowestFbmPrice
                  ? { lowestFbmPrice: result.pricing.lowestFbmPrice }
                  : {}),
              }
            : {}),
          ...(result.fee
            ? {
                operation: "getMyFeesEstimateForASIN",
                observationStatus:
                  result.fee.completeness === "COMPLETE"
                    ? ("SUCCESS" as const)
                    : ("PARTIAL" as const),
                requestHash: result.fee.requestHash,
                requestInputs: result.fee.requestInputs,
                completeness: result.fee.completeness,
                ...(result.fee.rawEvidenceReference
                  ? { rawEvidenceReference: result.fee.rawEvidenceReference }
                  : {}),
                ...(result.fee.rawEvidence !== undefined
                  ? {
                      rawEvidence: JSON.parse(
                        JSON.stringify(result.fee.rawEvidence),
                      ),
                    }
                  : {}),
                asin: item.asin,
                feeScenarioSource: result.fee.scenarioSource,
                feeFulfillment: result.fee.fulfillment,
                feeComponents: result.fee.components,
              }
            : {}),
          ...(result.restrictions
            ? {
                operation: "getListingsRestrictions",
                observationStatus:
                  result.restrictions.completeness === "COMPLETE"
                    ? ("SUCCESS" as const)
                    : ("PARTIAL" as const),
                requestHash: result.restrictions.requestHash,
                requestInputs: result.restrictions.requestInputs,
                completeness: result.restrictions.completeness,
                ...(result.restrictions.rawEvidenceReference
                  ? {
                      rawEvidenceReference:
                        result.restrictions.rawEvidenceReference,
                    }
                  : {}),
                ...(result.restrictions.rawEvidence !== undefined
                  ? {
                      rawEvidence: JSON.parse(
                        JSON.stringify(result.restrictions.rawEvidence),
                      ),
                    }
                  : {}),
                asin: item.asin,
                restrictionState: result.restrictions.state,
                restrictionReasonCodes: result.restrictions.reasonCodes,
                restrictionReasons: JSON.parse(
                  JSON.stringify(result.restrictions.reasons),
                ),
                ...(result.restrictions.conditionType
                  ? {
                      restrictionConditionType:
                        result.restrictions.conditionType,
                    }
                  : {}),
              }
            : {}),
        });
      } catch (error) {
        const detail = providerError(error);
        lastErrorCode = detail.code;
        missingMetrics.push(`${metric}_${detail.code}`);
        if (metric === "PRICING") {
          const requestInputs = pricingRequestInputs(
            item.asin,
            marketplace.marketplaceId,
          );
          observations.push({
            metricType: "PRICING",
            provider: providerKind,
            observedAt: new Date(),
            freshUntil: new Date(),
            freshnessState: "UNKNOWN",
            marketplaceId: marketplace.marketplaceId,
            payload: { errorCode: detail.code },
            operation: "getCompetitiveSummary",
            observationStatus:
              detail.code === "UNAUTHORIZED" || detail.code === "FORBIDDEN"
                ? "UNAUTHORIZED"
                : detail.status === "THROTTLED"
                  ? "THROTTLED"
                  : detail.status === "RETRYABLE_ERROR"
                    ? "RETRYABLE_FAILURE"
                    : detail.code === "NOT_FOUND"
                      ? "UNAVAILABLE"
                      : "TERMINAL_FAILURE",
            requestHash: stableHash(requestInputs),
            requestInputs,
            completeness: "UNKNOWN",
            asin: item.asin,
            featuredOfferState: "UNKNOWN",
            amazonRetailPresence: "UNKNOWN",
            visibleOfferCountCompleteness: "UNKNOWN",
            fbaOfferCountCompleteness: "UNKNOWN",
            fbmOfferCountCompleteness: "UNKNOWN",
          });
        } else if (metric === "FEES") {
          const requestInputs = {
            operation: "getMyFeesEstimateForASIN",
            asin: item.asin,
            marketplaceId: marketplace.marketplaceId,
            scenarioSource: "CURRENT_FEATURED_OFFER",
          };
          observations.push({
            metricType: "FEES",
            provider: providerKind,
            observedAt: new Date(),
            freshUntil: new Date(),
            freshnessState: "UNKNOWN",
            marketplaceId: marketplace.marketplaceId,
            payload: { errorCode: detail.code },
            operation: "getMyFeesEstimateForASIN",
            observationStatus: observationFailureStatus(detail),
            requestHash: stableHash(requestInputs),
            requestInputs,
            completeness: "UNKNOWN",
            asin: item.asin,
            feeScenarioSource: "CURRENT_FEATURED_OFFER",
            feeFulfillment: "UNKNOWN",
          });
        } else if (metric === "RESTRICTIONS") {
          const requestInputs = restrictionRequestInputs(
            item.asin,
            marketplace.marketplaceId,
          );
          observations.push({
            metricType: "RESTRICTIONS",
            provider: providerKind,
            observedAt: new Date(),
            freshUntil: new Date(),
            freshnessState: "UNKNOWN",
            marketplaceId: marketplace.marketplaceId,
            payload: { errorCode: detail.code },
            operation: "getListingsRestrictions",
            observationStatus: observationFailureStatus(detail),
            requestHash: stableHash(requestInputs),
            requestInputs,
            completeness: "UNKNOWN",
            asin: item.asin,
            restrictionState: restrictionFailureState(detail),
            restrictionReasonCodes: [],
            restrictionReasons: [],
            restrictionConditionType: "new_new",
          });
        }
        await recordProviderCallAttempt({
          organizationId: run.organizationId,
          enrichmentRunId: run.id,
          provider:
            metric === "HISTORY" && providerKind === "MOCK_AMAZON"
              ? "MOCK_HISTORY"
              : providerKind,
          operation: operationForMetric(metric),
          requestKey:
            metric === "PRICING"
              ? stableHash(
                  pricingRequestInputs(item.asin, marketplace.marketplaceId),
                )
              : metric === "FEES"
                ? stableHash({
                    operation: "getMyFeesEstimateForASIN",
                    asin: item.asin,
                    marketplaceId: marketplace.marketplaceId,
                    scenarioSource: "CURRENT_FEATURED_OFFER",
                  })
                : metric === "RESTRICTIONS"
                  ? stableHash(
                      restrictionRequestInputs(
                        item.asin,
                        marketplace.marketplaceId,
                      ),
                    )
                  : `${marketplace.marketplaceId}:${item.asin}`,
          attempt: run.attemptCount,
          status: detail.status,
          ...(detail.httpStatus ? { httpStatus: detail.httpStatus } : {}),
          ...(detail.providerRequestId
            ? { providerRequestId: detail.providerRequestId }
            : {}),
          ...(detail.retryAt ? { retryAt: detail.retryAt } : {}),
          errorCode: detail.code,
        });
        providerCalls.inc({
          operation: metric,
          outcome: detail.status.toLowerCase(),
        });
        if (
          detail.status === "THROTTLED" ||
          detail.status === "RETRYABLE_ERROR"
        ) {
          const candidate = detail.retryAt ?? providerRetryDeadline(undefined);
          if (!retryAt || candidate > retryAt) retryAt = candidate;
        }
      }
    }
    await persistEnrichmentItem({
      enrichmentItemId: item.id,
      observations,
      missingMetrics,
      ...(lastErrorCode ? { errorCode: lastErrorCode } : {}),
    });
  }
  if (retryAt && (await scheduleEnrichmentRetry(run.id, retryAt))) return;
  await completeEnrichmentRun(run.id);
}
