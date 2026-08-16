import { createHash } from "node:crypto";
import {
  getHistoryAnalyticsSource,
  persistHistoryAnalytics,
} from "@rizpoint/database";
import {
  analyzeHistory,
  HISTORY_ANALYTICS_VERSION,
  type HistoryMetricKey,
  type HistorySeries,
} from "@rizpoint/history-analytics";

const historyMetricKeys = new Set<HistoryMetricKey>([
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

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** Calculates a replayable, provider-scoped projection from normalized points.
 * It does not read raw provider payloads or alter wholesale profitability. */
export async function calculateHistoryAnalytics(input: {
  organizationId: string;
  catalogProductId: string;
  marketplaceId: string;
  providerKey: string;
  calculatedAt: Date;
}): Promise<void> {
  const source = await getHistoryAnalyticsSource(input);
  const series: HistorySeries[] = source.flatMap((entry) =>
    historyMetricKeys.has(entry.metricKey as HistoryMetricKey)
      ? [
          {
            metricKey: entry.metricKey as HistoryMetricKey,
            providerKey: entry.providerKey,
            unit: entry.unit,
            ...(entry.currency ? { currency: entry.currency } : {}),
            points: entry.points.map((point) => ({
              id: point.id,
              observedAt: point.metricAt.toISOString(),
              ...(point.decimalValue
                ? { decimalValue: point.decimalValue.toFixed(10) }
                : {}),
              ...(point.integerValue !== null
                ? { integerValue: point.integerValue.toString() }
                : {}),
              ...(point.booleanValue !== null
                ? { booleanValue: point.booleanValue }
                : {}),
              ...(point.textValue !== null
                ? { textValue: point.textValue }
                : {}),
            })),
          },
        ]
      : [],
  );
  const analytics = analyzeHistory({
    providerKey: input.providerKey,
    calculatedAt: input.calculatedAt.toISOString(),
    series,
  });
  const inputFingerprint = fingerprint({
    version: HISTORY_ANALYTICS_VERSION,
    providerKey: input.providerKey,
    marketplaceId: input.marketplaceId,
    points: analytics.inputPointIds,
  });
  await persistHistoryAnalytics({
    ...input,
    calculationVersion: HISTORY_ANALYTICS_VERSION,
    inputFingerprint,
    status: analytics.status,
    windowStart: new Date(input.calculatedAt.valueOf() - 365 * 86_400_000),
    windowEnd: input.calculatedAt,
    coveragePercent: analytics.price[365].coverage.ratioPercent,
    metrics: JSON.parse(JSON.stringify(analytics)),
    warnings: analytics.warnings,
    inputPointReferences: [...analytics.inputPointIds],
    calculatedAt: input.calculatedAt,
  });
}
