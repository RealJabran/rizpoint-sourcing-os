import {
  completeEnrichmentRun,
  getEnrichmentRunForProcessing,
  persistEnrichmentItem,
  recordProviderCallAttempt,
} from "@rizpoint/database";
import { MockAmazonProvider } from "@rizpoint/mock-providers";
import { ProviderError } from "@rizpoint/provider-contracts";

const marketplace = {
  marketplaceId: "ATVPDKIKX0DER",
  region: "NA" as const,
  sellerId: "mock-seller",
};
const FRESH_FOR_MS = 15 * 60_000;

type Metric = "CATALOG" | "PRICING" | "FEES" | "RESTRICTIONS" | "HISTORY";
type CachedResult = {
  metric: Metric;
  value: unknown;
  primaryAmount?: string;
  currency?: string;
  provider: "MOCK_AMAZON" | "MOCK_HISTORY";
  observedAt: Date;
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
        : ["TRANSIENT"].includes(error.code)
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
  const provider = new MockAmazonProvider();
  const cache = new Map<string, Promise<CachedResult>>();
  const call = (asin: string, metric: Metric): Promise<CachedResult> => {
    const key = `${metric}:${asin}`;
    const existing = cache.get(key);
    if (existing) return existing;
    const task = (async () => {
      const observedAt = new Date();
      const value =
        metric === "CATALOG"
          ? await provider.getItem(asin, marketplace)
          : metric === "PRICING"
            ? await provider.getCompetitivePricing(asin, marketplace)
            : metric === "FEES"
              ? await provider.estimateFees({
                  asin,
                  marketplace,
                  fulfillmentChannel: "AMAZON",
                  price: "17.99",
                  currency: "USD",
                  requestId: `${run.id}:${asin}`,
                })
              : metric === "RESTRICTIONS"
                ? await provider.getRestrictions(asin, marketplace)
                : await provider.getHistory(asin, marketplace);
      if (value == null) throw new ProviderError("NOT_FOUND");
      const observed = value as {
        provenance?: { providerReference?: string };
        value?: { lowestPrice?: string; totalFee?: string; currency?: string };
      };
      const amount =
        metric === "PRICING"
          ? observed.value?.lowestPrice
          : metric === "FEES"
            ? observed.value?.totalFee
            : undefined;
      const currency =
        metric === "PRICING" || metric === "FEES"
          ? observed.value?.currency
          : undefined;
      return {
        metric,
        value,
        observedAt,
        provider: (metric === "HISTORY"
          ? "MOCK_HISTORY"
          : "MOCK_AMAZON") as CachedResult["provider"],
        ...(observed.provenance?.providerReference
          ? { providerReference: observed.provenance.providerReference }
          : {}),
        ...(amount ? { primaryAmount: amount } : {}),
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
        observations.push({
          metricType: metric,
          provider: result.provider,
          observedAt: result.observedAt,
          freshUntil: new Date(result.observedAt.getTime() + FRESH_FOR_MS),
          marketplaceId: marketplace.marketplaceId,
          payload: JSON.parse(JSON.stringify(result.value)),
          ...(result.providerReference
            ? { providerReference: result.providerReference }
            : {}),
          ...(result.primaryAmount
            ? { primaryAmount: result.primaryAmount }
            : {}),
          ...(result.currency ? { currency: result.currency } : {}),
        });
      } catch (error) {
        const detail = providerError(error);
        lastErrorCode = detail.code;
        missingMetrics.push(`${metric}_${detail.code}`);
        await recordProviderCallAttempt({
          organizationId: run.organizationId,
          enrichmentRunId: run.id,
          provider: metric === "HISTORY" ? "MOCK_HISTORY" : "MOCK_AMAZON",
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
      }
    }
    await persistEnrichmentItem({
      enrichmentItemId: item.id,
      observations,
      missingMetrics,
      ...(lastErrorCode ? { errorCode: lastErrorCode } : {}),
    });
  }
  await completeEnrichmentRun(run.id);
}
