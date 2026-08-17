import { describe, expect, it } from "vitest";
import { calculateNicheOpportunityScore } from "../src/opportunity-scoring.js";
describe("deterministic niche opportunity score", () => {
  it("makes low-data confidence and score explicit", () => {
    const result = calculateNicheOpportunityScore([
      {
        productId: "p1",
        brand: "A",
        price: "20",
        reviewCount: "20",
        priceVolatilityPercent: null,
        listingAgeDays: null,
        amazonRetailPresence: null,
        historyStatus: null,
        historyAssessmentId: null,
        observedAt: null,
      },
    ]);
    expect(result.status).toBe("PARTIAL");
    expect(result.confidencePercent).toBe("40.00");
    expect(result.score).not.toBeNull();
  });
  it("is replayable for the same stored inputs and thresholds", () => {
    const input = [
      {
        productId: "p1",
        brand: "A",
        price: "20",
        reviewCount: "20",
        priceVolatilityPercent: "5",
        listingAgeDays: "50",
        amazonRetailPresence: "ABSENT",
        historyStatus: "COMPLETE",
        historyAssessmentId: "h1",
        observedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    expect(calculateNicheOpportunityScore(input)).toEqual(
      calculateNicheOpportunityScore(input),
    );
  });
});
