import { describe, expect, it } from "vitest";
import { advertisingObservationSchema } from "../src/index.js";

describe("advertising observation fixture", () => {
  it("requires provenance and does not require unavailable paid metrics", () => {
    expect(
      advertisingObservationSchema.parse({
        marketplaceId: "ATVPDKIKX0DER",
        keyword: "recorded fixture keyword",
        sponsoredAsin: "B000000001",
        sponsoredPosition: 3,
        provenance: {
          provider: "recorded-ad-fixture",
          observedAt: "2026-08-17T00:00:00Z",
          freshnessState: "FRESH",
        },
        completeness: "PARTIAL",
      }),
    ).toMatchObject({ sponsoredPosition: 3, completeness: "PARTIAL" });
    expect(() =>
      advertisingObservationSchema.parse({
        marketplaceId: "ATVPDKIKX0DER",
        keyword: "no evidence",
        completeness: "UNKNOWN",
      }),
    ).toThrow();
  });
});
