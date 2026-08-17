import { describe, expect, it } from "vitest";
import {
  backtestModel,
  estimateWithCalibratedModel,
  useLicensedProviderEstimate,
  type CalibratedSalesModel,
} from "../src/index.js";

const model: CalibratedSalesModel = {
  marketplaceId: "ATVPDKIKX0DER",
  categoryReference: "HOME",
  version: "home-us/2026-08",
  status: "VALIDATED",
  minimumHistoryPoints: 5,
  referenceDataset: {
    id: "licensed-reference-1",
    sourceReference: "dataset:licensed-reference-1",
    sampleSize: 2000,
    observedFrom: "2026-01-01",
    observedTo: "2026-06-30",
  },
  rankBands: [
    {
      maximumRank: "1000",
      monthlyUnitsLow: "500",
      monthlyUnitsCentral: "700",
      monthlyUnitsHigh: "950",
    },
    {
      maximumRank: "100000",
      monthlyUnitsLow: "10",
      monthlyUnitsCentral: "25",
      monthlyUnitsHigh: "50",
    },
  ],
};
const input = (ranks: string[], categoryReference = "HOME") => ({
  marketplaceId: "ATVPDKIKX0DER",
  categoryReference,
  salesRankHistory: ranks.map((rank, index) => ({
    rank,
    observedAt: `2026-06-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
    evidenceReference: `point-${index}`,
  })),
});

describe("calibrated sales estimation", () => {
  it("uses distinct calibrated ranges for high and low rank bands", () => {
    expect(
      estimateWithCalibratedModel(
        input(["100", "200", "300", "400", "500"]),
        model,
      ).monthlyUnitsCentral,
    ).toBe("700");
    expect(
      estimateWithCalibratedModel(
        input(["50000", "60000", "70000", "80000", "90000"]),
        model,
      ).monthlyUnitsCentral,
    ).toBe("25");
  });
  it("rejects sparse history", () =>
    expect(
      estimateWithCalibratedModel(input(["100", "200"]), model).reasonCode,
    ).toBe("SPARSE_RANK_HISTORY"));
  it("rejects category mismatch", () =>
    expect(
      estimateWithCalibratedModel(
        input(["100", "200", "300", "400", "500"], "TOYS"),
        model,
      ).reasonCode,
    ).toBe("CATEGORY_CALIBRATION_MISMATCH"));
  it("returns no estimate without a model", () =>
    expect(estimateWithCalibratedModel(input([])).reasonCode).toBe(
      "CALIBRATED_MODEL_NOT_FOUND",
    ));
  it("keeps licensed estimates distinct and rejects missing provider versions", () => {
    const provenance = {
      provider: "licensed-vendor",
      observedAt: "2026-08-17T00:00:00.000Z",
      freshnessState: "FRESH" as const,
      providerReference: "vendor-observation-1",
    };
    expect(
      useLicensedProviderEstimate({
        status: "AVAILABLE",
        monthlyUnitsLow: "80",
        monthlyUnitsHigh: "130",
        modelVersion: "vendor/model-4",
        provenance,
      }),
    ).toMatchObject({
      status: "AVAILABLE",
      source: "LICENSED_PROVIDER",
      modelVersion: "vendor/model-4",
    });
    expect(
      useLicensedProviderEstimate({
        status: "AVAILABLE",
        monthlyUnitsLow: "80",
        monthlyUnitsHigh: "130",
        provenance,
      }).status,
    ).toBe("UNAVAILABLE");
  });
  it("calculates reproducible backtest metrics from explicit fixtures", () =>
    expect(
      backtestModel([
        {
          actualUnits: "100",
          estimateLow: "80",
          estimateCentral: "90",
          estimateHigh: "120",
        },
      ]),
    ).toEqual({
      sampleSize: 1,
      mae: "10.00",
      mapePercent: "10.00",
      intervalCoveragePercent: "100.00",
    }));
});
