import { describe, expect, it } from "vitest";
import { feeEstimateSchema, provenanceSchema } from "../src/index.js";

describe("provider provenance", () => {
  it("requires source and freshness", () => {
    expect(() => provenanceSchema.parse({})).toThrow();
    expect(
      provenanceSchema.parse({
        provider: "mock",
        observedAt: "2026-07-12T00:00:00Z",
        freshnessState: "FRESH",
      }),
    ).toMatchObject({ provider: "mock" });
  });
});

describe("observed metrics", () => {
  it("requires provenance and decimal strings", () => {
    expect(() =>
      feeEstimateSchema.parse({ value: { totalFee: "1.25", currency: "USD" } }),
    ).toThrow();
    expect(
      feeEstimateSchema.parse({
        value: { totalFee: "1.25", currency: "USD" },
        provenance: {
          provider: "mock",
          observedAt: "2026-07-12T00:00:00Z",
          freshnessState: "FRESH",
        },
      }).value.totalFee,
    ).toBe("1.25");
  });
});
