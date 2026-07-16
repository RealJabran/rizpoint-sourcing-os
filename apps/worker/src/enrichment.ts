import {
  completeEnrichmentRun,
  getEnrichmentRunForProcessing,
  persistEnrichmentItem,
  recordProviderCallAttempt,
  scheduleEnrichmentRetry,
} from "@rizpoint/database";
import { ProviderError } from "@rizpoint/provider-contracts";
import { createHash } from "node:crypto";
import { createEnrichmentProvider } from "./enrichment-provider.js";
import { providerCalls } from "./observability.js";

const FRESH_FOR_MS = 15 * 60_000;
const TRANSIENT_RETRY_DELAY_MS = 30_000;

type Metric = "CATALOG" | "PRICING" | "FEES" | "RESTRICTIONS" | "HISTORY";
type CachedResult = {
  metric: Metric;
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
};

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function pricingRequestInputs(asin: string, marketplaceId: string) {
  return {
    operation: "getCompetitiveSummary",
    asin,
    marketplaceId,
    includedData: ["featuredBuyingOptions", "lowestPricedOffers"],
    lowestPricedOffersInputs: [{ itemCondition: "New", offerType: "Consumer" }],
  };
}

function providerError(error: unknown) {
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
    retryAt: error.options.retryAfterMs
      ? new Date(Date.now() + error.options.retryAfterMs)
      : undefined,
    httpStatus: error.options.httpStatus,
    providerRequestId: error.options.providerRequestId,
  };
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
          operation: metric === "PRICING" ? "getCompetitiveSummary" : metric,
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
    const pendingAsins = [
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
      const value =
        metric === "CATALOG"
          ? await provider.getItem(asin, marketplace)
          : metric === "PRICING"
            ? await (pricingPrefetch.get(asin) ??
                provider.getCompetitivePricing(asin, marketplace))
            : metric === "FEES"
              ? await (async () => {
                  const pricing = await call(asin, "PRICING");
                  const quotePrice = (
                    pricing.value as { value?: { lowestPrice?: string } }
                  ).value?.lowestPrice;
                  if (!quotePrice) throw new ProviderError("INVALID_RESPONSE");
                  return provider.estimateFees({
                    asin,
                    marketplace,
                    fulfillmentChannel: "AMAZON",
                    price: quotePrice,
                    currency: "USD",
                    requestId: `${run.id}:${asin}:${quotePrice}`,
                  });
                })()
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
              currency?: string;
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
          ? (observed.value as { lowestPrice?: string } | undefined)
              ?.lowestPrice
          : metric === "FEES"
            ? (observed.value as { totalFee?: string } | undefined)?.totalFee
            : undefined;
      const currency =
        metric === "PRICING" || metric === "FEES"
          ? (observed.value as { currency?: string } | undefined)?.currency
          : metric === "HISTORY"
            ? (observed.value as Array<{ currency?: string }> | undefined)?.[0]
                ?.currency
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
                      visibleOfferCount: pricingValue.totalVisibleOffers.value,
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
      };
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
        await recordProviderCallAttempt({
          organizationId: run.organizationId,
          enrichmentRunId: run.id,
          provider: result.provider,
          operation: metric === "PRICING" ? "getCompetitiveSummary" : metric,
          requestKey:
            metric === "PRICING"
              ? stableHash(
                  pricingRequestInputs(item.asin, marketplace.marketplaceId),
                )
              : `${marketplace.marketplaceId}:${item.asin}`,
          attempt: run.attemptCount,
          status: "SUCCESS",
        });
        providerCalls.inc({ operation: metric, outcome: "success" });
        observations.push({
          metricType: metric,
          provider: result.provider,
          observedAt: result.observedAt,
          freshUntil: new Date(result.observedAt.getTime() + FRESH_FOR_MS),
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
        }
        await recordProviderCallAttempt({
          organizationId: run.organizationId,
          enrichmentRunId: run.id,
          provider:
            metric === "HISTORY" && providerKind === "MOCK_AMAZON"
              ? "MOCK_HISTORY"
              : providerKind,
          operation: metric === "PRICING" ? "getCompetitiveSummary" : metric,
          requestKey:
            metric === "PRICING"
              ? stableHash(
                  pricingRequestInputs(item.asin, marketplace.marketplaceId),
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
          const candidate =
            detail.retryAt ?? new Date(Date.now() + TRANSIENT_RETRY_DELAY_MS);
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
