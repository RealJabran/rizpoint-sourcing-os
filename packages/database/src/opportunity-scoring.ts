import { Decimal } from "decimal.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export const NICHE_OPPORTUNITY_SCORE_VERSION = "niche-opportunity/v1";
export const NICHE_AGGREGATION_VERSION = "niche-aggregation/v1";

export type NicheScoreThresholds = {
  lowReviewMaximum: string;
  stablePriceVolatilityMaximum: string;
  minimumConfidencePercent: string;
};

export const DEFAULT_NICHE_SCORE_THRESHOLDS: NicheScoreThresholds = {
  lowReviewMaximum: "100",
  stablePriceVolatilityMaximum: "15",
  minimumConfidencePercent: "60",
};

export type NicheScoreInputRow = {
  productId: string;
  brand: string | null;
  reviewCount: string | null;
  price: string | null;
  priceVolatilityPercent: string | null;
  listingAgeDays: string | null;
  amazonRetailPresence: string | null;
  historyStatus: string | null;
  historyAssessmentId: string | null;
  observedAt: string | null;
};

type Component = {
  key: string;
  label: string;
  score: string | null;
  observedCount: number;
  explanation: string;
};

function numeric(value: string | null): Decimal | null {
  if (value === null) return null;
  try {
    const parsed = new Decimal(value);
    return parsed.isFinite() ? parsed : null;
  } catch {
    return null;
  }
}

function median(values: Decimal[]) {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left.comparedTo(right));
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? ordered[middle]!
    : ordered[middle]!.plus(ordered[middle - 1]!).div(2);
}

function fixed(value: Decimal | null, places = 2) {
  return value?.toFixed(places) ?? null;
}

function bounded(value: Decimal) {
  return Decimal.max(0, Decimal.min(100, value));
}

function observedNumber(value: string | null): Decimal[] {
  const parsed = numeric(value);
  return parsed ? [parsed] : [];
}

/** This scorer uses only observed, stored facts. It does not translate BSR,
 * review count, or any provider history into an unlicensed demand estimate. */
export function calculateNicheOpportunityScore(
  rows: readonly NicheScoreInputRow[],
  thresholds: NicheScoreThresholds = DEFAULT_NICHE_SCORE_THRESHOLDS,
) {
  const reviews = rows.flatMap((row) => {
    const value = numeric(row.reviewCount);
    return value ? [value] : [];
  });
  const volatility = rows.flatMap((row) => {
    const value = numeric(row.priceVolatilityPercent);
    return value ? [value] : [];
  });
  const listingAges = rows.flatMap((row) => {
    const value = numeric(row.listingAgeDays);
    return value ? [value] : [];
  });
  const prices = rows.flatMap((row) => {
    const value = numeric(row.price);
    return value ? [value] : [];
  });
  const lowReviewMaximum = new Decimal(thresholds.lowReviewMaximum);
  const stableVolatilityMaximum = new Decimal(
    thresholds.stablePriceVolatilityMaximum,
  );
  const reviewMedian = median(reviews);
  const volatilityMedian = median(volatility);
  const lowReviewScore = reviewMedian
    ? bounded(
        new Decimal(100).minus(reviewMedian.div(lowReviewMaximum).times(100)),
      )
    : null;
  const priceStabilityScore = volatilityMedian
    ? bounded(
        new Decimal(100).minus(
          volatilityMedian.div(stableVolatilityMaximum).times(100),
        ),
      )
    : null;
  const brandCounts = new Map<string, number>();
  for (const row of rows) {
    if (!row.brand?.trim()) continue;
    brandCounts.set(row.brand, (brandCounts.get(row.brand) ?? 0) + 1);
  }
  const brandHhi = brandCounts.size
    ? [...brandCounts.values()]
        .reduce(
          (total, count) =>
            total.plus(new Decimal(count).div(rows.length).pow(2)),
          new Decimal(0),
        )
        .times(10000)
    : null;
  const brandCompetitionScore = brandHhi
    ? bounded(new Decimal(100).minus(brandHhi.div(100)))
    : null;
  const retailKnown = rows.filter(
    (row) => row.amazonRetailPresence && row.amazonRetailPresence !== "UNKNOWN",
  );
  const retailAbsentScore = retailKnown.length
    ? new Decimal(
        retailKnown.filter((row) => row.amazonRetailPresence === "ABSENT")
          .length,
      )
        .div(retailKnown.length)
        .times(100)
    : null;
  const newEntrantScore = listingAges.length
    ? new Decimal(listingAges.filter((age) => age.lte(90)).length)
        .div(listingAges.length)
        .times(100)
    : null;
  const components: Component[] = [
    {
      key: "reviewBarrier",
      label: "Review barrier",
      score: fixed(lowReviewScore),
      observedCount: reviews.length,
      explanation:
        "Lower median observed review count scores higher against the configured review threshold.",
    },
    {
      key: "priceStability",
      label: "Price stability",
      score: fixed(priceStabilityScore),
      observedCount: volatility.length,
      explanation:
        "Lower observed 90-day price volatility scores higher against the configured stability threshold.",
    },
    {
      key: "amazonRetailAbsence",
      label: "Amazon Retail absence",
      score: fixed(retailAbsentScore),
      observedCount: retailKnown.length,
      explanation:
        "Share of known latest offer observations where Amazon Retail is absent.",
    },
    {
      key: "brandConcentration",
      label: "Brand concentration",
      score: fixed(brandCompetitionScore),
      observedCount: brandCounts.size
        ? rows.filter((row) => Boolean(row.brand?.trim())).length
        : 0,
      explanation:
        "Lower tracked-universe brand HHI scores higher; this is not a category-wide market-share claim.",
    },
    {
      key: "newEntrantPresence",
      label: "New-entrant presence",
      score: fixed(newEntrantScore),
      observedCount: listingAges.length,
      explanation:
        "Share of products with an observed listing age of 90 days or less; this is not success or sales evidence.",
    },
  ];
  const scoreValues = components.flatMap((component) =>
    component.score === null ? [] : [new Decimal(component.score)],
  );
  const possibleObservations = rows.length * components.length;
  const observedObservations = components.reduce(
    (total, component) => total + component.observedCount,
    0,
  );
  const confidence = possibleObservations
    ? Decimal.min(
        100,
        new Decimal(observedObservations).div(possibleObservations).times(100),
      )
    : new Decimal(0);
  const rawScore = scoreValues.length
    ? scoreValues
        .reduce((total, score) => total.plus(score), new Decimal(0))
        .div(scoreValues.length)
    : null;
  const score = rawScore ? rawScore.times(confidence).div(100) : null;
  const minimumConfidence = new Decimal(thresholds.minimumConfidencePercent);
  const status: "COMPLETE" | "PARTIAL" | "INSUFFICIENT_DATA" =
    !rows.length || confidence.eq(0)
      ? "INSUFFICIENT_DATA"
      : confidence.gte(minimumConfidence)
        ? "COMPLETE"
        : "PARTIAL";
  return {
    status,
    score: fixed(score),
    confidencePercent: fixed(confidence),
    thresholds,
    components,
    metrics: {
      productCount: rows.length,
      medianPrice: fixed(median(prices)),
      averagePrice: prices.length
        ? fixed(
            prices
              .reduce((total, value) => total.plus(value), new Decimal(0))
              .div(prices.length),
          )
        : null,
      medianReviews: fixed(reviewMedian),
      medianPriceVolatilityPercent: fixed(volatilityMedian),
      medianListingAgeDays: fixed(median(listingAges)),
      top10ReviewDistribution: rows
        .flatMap((row) => observedNumber(row.reviewCount))
        .sort((left, right) => right.comparedTo(left))
        .slice(0, 10)
        .map((value) => value.toFixed(0)),
      top20ReviewDistribution: rows
        .flatMap((row) => observedNumber(row.reviewCount))
        .sort((left, right) => right.comparedTo(left))
        .slice(0, 20)
        .map((value) => value.toFixed(0)),
      brandHhi: fixed(brandHhi, 0),
    },
  };
}
