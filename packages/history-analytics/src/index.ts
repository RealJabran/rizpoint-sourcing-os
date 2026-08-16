import { Decimal } from "decimal.js";

Decimal.set({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -100,
  toExpPos: 100,
});

export const HISTORY_ANALYTICS_VERSION = "history-analytics/v1";
export const HISTORY_WINDOWS = [30, 90, 180, 365] as const;
export type HistoryWindowDays = (typeof HISTORY_WINDOWS)[number];
export type HistoryMetricKey =
  | "AMAZON_PRICE"
  | "NEW_OFFER_PRICE"
  | "FEATURED_OFFER_PRICE"
  | "SALES_RANK"
  | "OFFER_COUNT"
  | "AMAZON_RETAIL_PRESENT"
  | "RATING"
  | "REVIEW_COUNT"
  | "PRODUCT_FIRST_OBSERVED_AT"
  | "CATEGORY_CONTEXT";
export type AnalyticsStatus = "COMPLETE" | "PARTIAL" | "INSUFFICIENT_DATA";
export type CoverageConfidence = "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT";

export type HistoryPoint = Readonly<{
  id: string;
  observedAt: string;
  decimalValue?: string | undefined;
  integerValue?: string | undefined;
  booleanValue?: boolean | undefined;
  textValue?: string | undefined;
}>;

export type HistorySeries = Readonly<{
  metricKey: HistoryMetricKey;
  providerKey: string;
  unit: string;
  currency?: string | undefined;
  points: readonly HistoryPoint[];
}>;

export type HistoryAnalyticsInput = Readonly<{
  providerKey: string;
  calculatedAt: string;
  series: readonly HistorySeries[];
}>;

type NumericSample = Readonly<{ at: Date; value: Decimal; pointId: string }>;
type BooleanSample = Readonly<{ at: Date; value: boolean; pointId: string }>;

export type Coverage = Readonly<{
  observations: number;
  coveredDays: number;
  expectedDays: number;
  ratioPercent: string;
  confidence: CoverageConfidence;
}>;

export type WindowMetric = Readonly<{
  status: AnalyticsStatus;
  coverage: Coverage;
  median?: string | undefined;
  mean?: string | undefined;
  conservativePercentile20?: string | undefined;
  volatilityPercent?: string | undefined;
  maxDrawdownPercent?: string | undefined;
  frequentDropPercent?: string | undefined;
  trendSlopePerDay?: string | undefined;
}>;

export type HistoryAnalytics = Readonly<{
  version: typeof HISTORY_ANALYTICS_VERSION;
  status: AnalyticsStatus;
  calculatedAt: string;
  providerKey: string;
  inputPointIds: readonly string[];
  priceSourceMetricKey?: HistoryMetricKey | undefined;
  price: Readonly<Record<HistoryWindowDays, WindowMetric>>;
  salesRank: Readonly<Record<HistoryWindowDays, WindowMetric>>;
  offerCount: Readonly<Record<HistoryWindowDays, WindowMetric>>;
  amazonRetailPresence: Readonly<
    Record<
      HistoryWindowDays,
      Readonly<{
        status: AnalyticsStatus;
        coverage: Coverage;
        presentPercent?: string;
      }>
    >
  >;
  reviewCountGrowth: Readonly<
    Record<
      HistoryWindowDays,
      Readonly<{
        status: AnalyticsStatus;
        coverage: Coverage;
        growth?: string;
        trendSlopePerDay?: string;
      }>
    >
  >;
  estimatedListingAgeDays?: string | undefined;
  firstObservedAt?: string | undefined;
  seasonalIndex?:
    | Readonly<{
        status: AnalyticsStatus;
        indexPercent?: string;
        coverage: Coverage;
        explanation: string;
      }>
    | undefined;
  warnings: readonly string[];
}>;

const DAY_MS = 86_400_000;
const REQUIRED_OBSERVATIONS = 5;

function decimal(value: string): Decimal | null {
  try {
    const parsed = new Decimal(value);
    return parsed.isFinite() ? parsed : null;
  } catch {
    return null;
  }
}

function isoDate(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

function fixed(value: Decimal, places = 4): string {
  return value.toFixed(places);
}

function sortSamples<T extends { at: Date }>(samples: readonly T[]): T[] {
  return [...samples].sort(
    (left, right) => left.at.valueOf() - right.at.valueOf(),
  );
}

function numericSamples(series: HistorySeries | undefined): NumericSample[] {
  if (!series) return [];
  return sortSamples(
    series.points.flatMap((point) => {
      const at = isoDate(point.observedAt);
      const raw = point.decimalValue ?? point.integerValue;
      const value = raw ? decimal(raw) : null;
      return at && value ? [{ at, value, pointId: point.id }] : [];
    }),
  );
}

function booleanSamples(series: HistorySeries | undefined): BooleanSample[] {
  if (!series) return [];
  return sortSamples(
    series.points.flatMap((point) => {
      const at = isoDate(point.observedAt);
      return at && point.booleanValue !== undefined
        ? [{ at, value: point.booleanValue, pointId: point.id }]
        : [];
    }),
  );
}

function coverage(samples: readonly { at: Date }[], days: number): Coverage {
  const dayKeys = new Set(
    samples.map((sample) => sample.at.toISOString().slice(0, 10)),
  );
  const ratio = Decimal.min(
    new Decimal(dayKeys.size).div(days),
    new Decimal(1),
  );
  const confidence: CoverageConfidence =
    samples.length < REQUIRED_OBSERVATIONS || ratio.lt(0.25)
      ? "INSUFFICIENT"
      : ratio.gte(0.75)
        ? "HIGH"
        : ratio.gte(0.4)
          ? "MEDIUM"
          : "LOW";
  return {
    observations: samples.length,
    coveredDays: dayKeys.size,
    expectedDays: days,
    ratioPercent: fixed(ratio.times(100), 2),
    confidence,
  };
}

function statusFor(value: Coverage): AnalyticsStatus {
  if (value.confidence === "INSUFFICIENT") return "INSUFFICIENT_DATA";
  return value.confidence === "HIGH" ? "COMPLETE" : "PARTIAL";
}

function mean(values: readonly Decimal[]): Decimal {
  return values
    .reduce((total, value) => total.plus(value), new Decimal(0))
    .div(values.length);
}

function median(values: readonly Decimal[]): Decimal {
  const ordered = [...values].sort((left, right) => left.comparedTo(right));
  const midpoint = Math.floor(ordered.length / 2);
  const current = ordered[midpoint]!;
  return ordered.length % 2 === 1
    ? current
    : current.plus(ordered[midpoint - 1]!).div(2);
}

function percentile(
  values: readonly Decimal[],
  percentileValue: number,
): Decimal {
  const ordered = [...values].sort((left, right) => left.comparedTo(right));
  const index = Math.max(
    0,
    Math.ceil((percentileValue / 100) * ordered.length) - 1,
  );
  return ordered[index]!;
}

function standardDeviation(
  values: readonly Decimal[],
  average: Decimal,
): Decimal {
  return mean(values.map((value) => value.minus(average).pow(2))).sqrt();
}

function slope(samples: readonly NumericSample[]): Decimal | null {
  if (samples.length < 2) return null;
  const origin = samples[0]!.at.valueOf();
  const xs = samples.map((sample) =>
    new Decimal(sample.at.valueOf() - origin).div(DAY_MS),
  );
  const xMean = mean(xs);
  const yMean = mean(samples.map((sample) => sample.value));
  let numerator = new Decimal(0);
  let denominator = new Decimal(0);
  samples.forEach((sample, index) => {
    const delta = xs[index]!.minus(xMean);
    numerator = numerator.plus(delta.times(sample.value.minus(yMean)));
    denominator = denominator.plus(delta.pow(2));
  });
  return denominator.isZero() ? null : numerator.div(denominator);
}

function maxDrawdown(samples: readonly NumericSample[]): Decimal | null {
  let high: Decimal | null = null;
  let worst: Decimal | null = null;
  for (const sample of samples) {
    if (sample.value.lte(0)) continue;
    if (!high || sample.value.gt(high)) high = sample.value;
    const drawdown = sample.value.minus(high).div(high).times(100);
    if (!worst || drawdown.lt(worst)) worst = drawdown;
  }
  return worst;
}

function frequentDropPercent(
  samples: readonly NumericSample[],
): Decimal | null {
  if (samples.length < 2) return null;
  let eligible = 0;
  let drops = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1]!.value;
    const current = samples[index]!.value;
    if (previous.lte(0)) continue;
    eligible += 1;
    if (current.minus(previous).div(previous).times(100).lte(-10)) drops += 1;
  }
  return eligible ? new Decimal(drops).div(eligible).times(100) : null;
}

function filterWindow<T extends { at: Date }>(
  samples: readonly T[],
  now: Date,
  days: number,
): T[] {
  const start = now.valueOf() - days * DAY_MS;
  return samples.filter(
    (sample) =>
      sample.at.valueOf() >= start && sample.at.valueOf() <= now.valueOf(),
  );
}

function numericWindowMetric(
  samples: readonly NumericSample[],
  now: Date,
  days: number,
  includeDrawdown: boolean,
): WindowMetric {
  const within = filterWindow(samples, now, days);
  const windowCoverage = coverage(within, days);
  const status = statusFor(windowCoverage);
  if (status === "INSUFFICIENT_DATA")
    return { status, coverage: windowCoverage };
  const values = within.map((sample) => sample.value);
  const average = mean(values);
  const volatility = average.isZero()
    ? null
    : standardDeviation(values, average).div(average.abs()).times(100);
  return {
    status,
    coverage: windowCoverage,
    median: fixed(median(values)),
    mean: fixed(average),
    conservativePercentile20: fixed(percentile(values, 20)),
    ...(volatility ? { volatilityPercent: fixed(volatility, 2) } : {}),
    ...(includeDrawdown && maxDrawdown(within)
      ? { maxDrawdownPercent: fixed(maxDrawdown(within)!, 2) }
      : {}),
    ...(includeDrawdown && frequentDropPercent(within)
      ? { frequentDropPercent: fixed(frequentDropPercent(within)!, 2) }
      : {}),
    ...(slope(within) ? { trendSlopePerDay: fixed(slope(within)!, 6) } : {}),
  };
}

function booleanWindowMetric(
  samples: readonly BooleanSample[],
  now: Date,
  days: number,
) {
  const within = filterWindow(samples, now, days);
  const windowCoverage = coverage(within, days);
  const status = statusFor(windowCoverage);
  if (status === "INSUFFICIENT_DATA")
    return { status, coverage: windowCoverage };
  return {
    status,
    coverage: windowCoverage,
    presentPercent: fixed(
      new Decimal(within.filter((sample) => sample.value).length)
        .div(within.length)
        .times(100),
      2,
    ),
  };
}

function reviewGrowth(
  samples: readonly NumericSample[],
  now: Date,
  days: number,
) {
  const within = filterWindow(samples, now, days);
  const windowCoverage = coverage(within, days);
  const status = statusFor(windowCoverage);
  if (status === "INSUFFICIENT_DATA")
    return { status, coverage: windowCoverage };
  return {
    status,
    coverage: windowCoverage,
    growth: fixed(within.at(-1)!.value.minus(within[0]!.value)),
    ...(slope(within) ? { trendSlopePerDay: fixed(slope(within)!, 6) } : {}),
  };
}

function seasonalIndex(samples: readonly NumericSample[], now: Date) {
  const within = filterWindow(samples, now, 365);
  const windowCoverage = coverage(within, 365);
  const monthKeys = new Set(
    within.map(
      (sample) => `${sample.at.getUTCFullYear()}-${sample.at.getUTCMonth()}`,
    ),
  );
  if (within.length < REQUIRED_OBSERVATIONS || monthKeys.size < 6)
    return {
      status: "INSUFFICIENT_DATA" as const,
      coverage: windowCoverage,
      explanation:
        "At least six observed calendar months are required; missing months are not filled.",
    };
  const latestMonth = within.at(-1)!.at.getUTCMonth();
  const currentMonth = within.filter(
    (sample) => sample.at.getUTCMonth() === latestMonth,
  );
  const overall = mean(within.map((sample) => sample.value));
  const index = overall.isZero()
    ? null
    : mean(currentMonth.map((sample) => sample.value))
        .div(overall)
        .times(100);
  return {
    status: statusFor(windowCoverage),
    coverage: windowCoverage,
    ...(index ? { indexPercent: fixed(index, 2) } : {}),
    explanation:
      "Latest observed calendar-month average divided by the observed 365-day average; no missing-month interpolation.",
  };
}

function selectPriceSeries(
  series: readonly HistorySeries[],
): HistorySeries | undefined {
  return ["FEATURED_OFFER_PRICE", "NEW_OFFER_PRICE", "AMAZON_PRICE"]
    .map((key) =>
      series.find(
        (entry) => entry.metricKey === key && entry.points.length > 0,
      ),
    )
    .find((entry): entry is HistorySeries => entry !== undefined);
}

function buildWindowRecord<T>(
  create: (days: HistoryWindowDays) => T,
): Record<HistoryWindowDays, T> {
  return Object.fromEntries(
    HISTORY_WINDOWS.map((days) => [days, create(days)]),
  ) as Record<HistoryWindowDays, T>;
}

function listingAge(series: readonly HistorySeries[], now: Date) {
  const firstObserved = series
    .filter((entry) => entry.metricKey === "PRODUCT_FIRST_OBSERVED_AT")
    .flatMap((entry) => entry.points)
    .map((point) => point.textValue)
    .filter((value): value is string => Boolean(value))
    .map(isoDate)
    .filter((value): value is Date => value !== null)
    .sort((left, right) => left.valueOf() - right.valueOf())[0];
  if (!firstObserved || firstObserved.valueOf() > now.valueOf()) return {};
  return {
    firstObservedAt: firstObserved.toISOString(),
    estimatedListingAgeDays: fixed(
      new Decimal(now.valueOf() - firstObserved.valueOf()).div(DAY_MS),
      1,
    ),
  };
}

/**
 * Pure deterministic analysis of persisted provider points. It intentionally
 * never fills missing dates, estimates sales from rank, or assigns a score.
 */
export function analyzeHistory(input: HistoryAnalyticsInput): HistoryAnalytics {
  const now = isoDate(input.calculatedAt);
  if (!now) throw new Error("HISTORY_ANALYTICS_CALCULATED_AT_INVALID");
  const series = input.series.filter(
    (entry) => entry.providerKey === input.providerKey,
  );
  const priceSeries = selectPriceSeries(series);
  const priceSamples = numericSamples(priceSeries);
  const rankSamples = numericSamples(
    series.find((entry) => entry.metricKey === "SALES_RANK"),
  );
  const offerSamples = numericSamples(
    series.find((entry) => entry.metricKey === "OFFER_COUNT"),
  );
  const retailSamples = booleanSamples(
    series.find((entry) => entry.metricKey === "AMAZON_RETAIL_PRESENT"),
  );
  const reviewSamples = numericSamples(
    series.find((entry) => entry.metricKey === "REVIEW_COUNT"),
  );
  const allIds = series
    .flatMap((entry) => entry.points.map((point) => point.id))
    .sort();
  const price = buildWindowRecord((days) =>
    numericWindowMetric(priceSamples, now, days, true),
  );
  const salesRank = buildWindowRecord((days) =>
    numericWindowMetric(rankSamples, now, days, false),
  );
  const offerCount = buildWindowRecord((days) =>
    numericWindowMetric(offerSamples, now, days, false),
  );
  const amazonRetailPresence = buildWindowRecord((days) =>
    booleanWindowMetric(retailSamples, now, days),
  );
  const reviewCountGrowth = buildWindowRecord((days) =>
    reviewGrowth(reviewSamples, now, days),
  );
  const warnings = [
    ...(Object.values(price).some((metric) =>
      new Decimal(metric.maxDrawdownPercent ?? 0).lte(-35),
    )
      ? ["PRICE_DRAWDOWN_HIGH"]
      : []),
    ...(Object.values(price).some((metric) =>
      new Decimal(metric.frequentDropPercent ?? 0).gte(25),
    )
      ? ["FREQUENT_PRICE_DROPS"]
      : []),
    ...(Object.values(salesRank).some((metric) =>
      new Decimal(metric.volatilityPercent ?? 0).gte(50),
    )
      ? ["BSR_VOLATILITY_HIGH"]
      : []),
    ...(Object.values(salesRank).some(
      (metric) =>
        new Decimal(metric.volatilityPercent ?? 0).gte(50) &&
        new Decimal(metric.trendSlopePerDay ?? 0).lt(0),
    )
      ? ["POSSIBLE_FAD_PATTERN"]
      : []),
  ];
  const allStatuses = [
    ...Object.values(price),
    ...Object.values(salesRank),
    ...Object.values(offerCount),
    ...Object.values(amazonRetailPresence),
    ...Object.values(reviewCountGrowth),
  ].map((metric) => metric.status);
  const status: AnalyticsStatus = allStatuses.includes("COMPLETE")
    ? allStatuses.includes("INSUFFICIENT_DATA")
      ? "PARTIAL"
      : "COMPLETE"
    : "INSUFFICIENT_DATA";
  return {
    version: HISTORY_ANALYTICS_VERSION,
    status,
    calculatedAt: now.toISOString(),
    providerKey: input.providerKey,
    inputPointIds: allIds,
    ...(priceSeries ? { priceSourceMetricKey: priceSeries.metricKey } : {}),
    price,
    salesRank,
    offerCount,
    amazonRetailPresence,
    reviewCountGrowth,
    ...listingAge(series, now),
    seasonalIndex: seasonalIndex(priceSamples, now),
    warnings,
  };
}
