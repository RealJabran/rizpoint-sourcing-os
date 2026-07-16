import {
  completeEnrichmentRun,
  getEnrichmentRunForProcessing,
  persistEnrichmentItem,
  recordProviderCallAttempt,
  scheduleEnrichmentRetry,
} from "@rizpoint/database";
import { ProviderError } from "@rizpoint/provider-contracts";
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
};

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
        await recordProviderCallAttempt({
          organizationId: run.organizationId,
          enrichmentRunId: run.id,
          provider,
          operation: metric,
          requestKey: `${run.providerConnection?.marketplaceId ?? "UNKNOWN"}:${item.asin}`,
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
        observations: [],
        missingMetrics,
        errorCode: detail.code,
      });
    }
    await completeEnrichmentRun(run.id);
    return;
  }
  const { provider, providerKind, marketplace } = bundle;
  const cache = new Map<string, Promise<CachedResult>>();
  let retryAt: Date | undefined;
  const call = (asin: string, metric: Metric): Promise<CachedResult> => {
    const key = `${metric}:${asin}`;
    const existing = cache.get(key);
    if (existing) return existing;
    const task = (async () => {
      const value =
        metric === "CATALOG"
          ? await provider.getItem(asin, marketplace)
          : metric === "PRICING"
            ? await provider.getCompetitivePricing(asin, marketplace)
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
          (observation) => observation.metricType === metric,
        )
      )
        continue;
      try {
        const result = await call(item.asin, metric);
        await recordProviderCallAttempt({
          organizationId: run.organizationId,
          enrichmentRunId: run.id,
          provider: result.provider,
          operation: metric,
          requestKey: `${marketplace.marketplaceId}:${item.asin}`,
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
        });
      } catch (error) {
        const detail = providerError(error);
        lastErrorCode = detail.code;
        missingMetrics.push(`${metric}_${detail.code}`);
        await recordProviderCallAttempt({
          organizationId: run.organizationId,
          enrichmentRunId: run.id,
          provider:
            metric === "HISTORY" && providerKind === "MOCK_AMAZON"
              ? "MOCK_HISTORY"
              : providerKind,
          operation: metric,
          requestKey: `${marketplace.marketplaceId}:${item.asin}`,
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
