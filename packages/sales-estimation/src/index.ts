import { Decimal } from "decimal.js";
import type { SalesEstimateProviderResult } from "@rizpoint/provider-contracts";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export const SALES_ESTIMATION_ENGINE_VERSION = "sales-estimation/v1";

export type RankBand = {
  maximumRank: string;
  monthlyUnitsLow: string;
  monthlyUnitsCentral: string;
  monthlyUnitsHigh: string;
};
export type CalibratedSalesModel = {
  marketplaceId: string;
  categoryReference: string;
  version: string;
  status: "VALIDATED" | "DRAFT" | "RETIRED";
  referenceDataset: {
    id: string;
    sourceReference: string;
    sampleSize: number;
    observedFrom: string;
    observedTo: string;
  };
  minimumHistoryPoints: number;
  rankBands: readonly RankBand[];
};
export type SalesEstimationInput = {
  marketplaceId: string;
  categoryReference?: string;
  salesRankHistory: readonly {
    rank: string;
    observedAt: string;
    evidenceReference: string;
  }[];
};
export type SalesEstimate = {
  status: "AVAILABLE" | "UNAVAILABLE";
  source: "LICENSED_PROVIDER" | "RIZPOINT_CALIBRATED_MODEL" | "NONE";
  monthlyUnitsLow?: string;
  monthlyUnitsCentral?: string;
  monthlyUnitsHigh?: string;
  confidencePercent?: string;
  modelVersion?: string;
  provenanceReferences: string[];
  reasonCode?: string;
};

function median(values: Decimal[]) {
  const sorted = [...values].sort((a, b) => a.comparedTo(b));
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]!
    : sorted[middle]!.plus(sorted[middle - 1]!).div(2);
}
function unavailable(reasonCode: string): SalesEstimate {
  return {
    status: "UNAVAILABLE",
    source: "NONE",
    provenanceReferences: [],
    reasonCode,
  };
}

export function useLicensedProviderEstimate(
  result: SalesEstimateProviderResult,
): SalesEstimate {
  if (
    result.status !== "AVAILABLE" ||
    !result.monthlyUnitsLow ||
    !result.monthlyUnitsHigh ||
    !result.modelVersion
  )
    return unavailable(result.reasonCode ?? "PROVIDER_ESTIMATE_UNAVAILABLE");
  return {
    status: "AVAILABLE",
    source: "LICENSED_PROVIDER",
    monthlyUnitsLow: result.monthlyUnitsLow,
    ...(result.monthlyUnitsCentral
      ? { monthlyUnitsCentral: result.monthlyUnitsCentral }
      : {}),
    monthlyUnitsHigh: result.monthlyUnitsHigh,
    ...(result.confidencePercent
      ? { confidencePercent: result.confidencePercent }
      : {}),
    modelVersion: result.modelVersion,
    provenanceReferences: [
      result.provenance.providerReference ??
        `${result.provenance.provider}:${result.provenance.observedAt}`,
    ],
  };
}

export function estimateWithCalibratedModel(
  input: SalesEstimationInput,
  model?: CalibratedSalesModel,
): SalesEstimate {
  if (!model) return unavailable("CALIBRATED_MODEL_NOT_FOUND");
  if (
    model.status !== "VALIDATED" ||
    !model.referenceDataset.sourceReference ||
    model.referenceDataset.sampleSize <= 0
  )
    return unavailable("CALIBRATED_MODEL_NOT_VALIDATED");
  if (model.marketplaceId !== input.marketplaceId)
    return unavailable("MARKETPLACE_CALIBRATION_MISMATCH");
  if (
    !input.categoryReference ||
    model.categoryReference !== input.categoryReference
  )
    return unavailable("CATEGORY_CALIBRATION_MISMATCH");
  if (input.salesRankHistory.length < model.minimumHistoryPoints)
    return unavailable("SPARSE_RANK_HISTORY");
  const ranks = input.salesRankHistory.flatMap((point) => {
    try {
      const rank = new Decimal(point.rank);
      return rank.gt(0) ? [rank] : [];
    } catch {
      return [];
    }
  });
  if (ranks.length < model.minimumHistoryPoints)
    return unavailable("SPARSE_RANK_HISTORY");
  const representativeRank = median(ranks);
  const band = [...model.rankBands]
    .sort((a, b) => new Decimal(a.maximumRank).comparedTo(b.maximumRank))
    .find((candidate) => representativeRank.lte(candidate.maximumRank));
  if (!band) return unavailable("RANK_OUTSIDE_CALIBRATED_RANGE");
  const coverage = Decimal.min(
    100,
    new Decimal(ranks.length)
      .div(Math.max(model.minimumHistoryPoints, 1))
      .times(80),
  );
  return {
    status: "AVAILABLE",
    source: "RIZPOINT_CALIBRATED_MODEL",
    monthlyUnitsLow: band.monthlyUnitsLow,
    monthlyUnitsCentral: band.monthlyUnitsCentral,
    monthlyUnitsHigh: band.monthlyUnitsHigh,
    confidencePercent: coverage.toFixed(2),
    modelVersion: model.version,
    provenanceReferences: [
      model.referenceDataset.sourceReference,
      ...input.salesRankHistory.map((point) => point.evidenceReference),
    ],
  };
}

export function backtestModel(
  cases: readonly {
    actualUnits: string;
    estimateLow: string;
    estimateCentral: string;
    estimateHigh: string;
  }[],
) {
  if (!cases.length)
    return {
      sampleSize: 0,
      mae: null,
      mapePercent: null,
      intervalCoveragePercent: null,
    };
  const absolute = cases.map((item) =>
    new Decimal(item.actualUnits).minus(item.estimateCentral).abs(),
  );
  const percentage = cases
    .filter((item) => !new Decimal(item.actualUnits).eq(0))
    .map((item) =>
      new Decimal(item.actualUnits)
        .minus(item.estimateCentral)
        .abs()
        .div(item.actualUnits)
        .times(100),
    );
  const covered = cases.filter(
    (item) =>
      new Decimal(item.actualUnits).gte(item.estimateLow) &&
      new Decimal(item.actualUnits).lte(item.estimateHigh),
  ).length;
  const mean = (values: Decimal[]) =>
    values
      .reduce((sum, value) => sum.plus(value), new Decimal(0))
      .div(values.length);
  return {
    sampleSize: cases.length,
    mae: mean(absolute).toFixed(2),
    mapePercent: percentage.length ? mean(percentage).toFixed(2) : null,
    intervalCoveragePercent: new Decimal(covered)
      .div(cases.length)
      .times(100)
      .toFixed(2),
  };
}
