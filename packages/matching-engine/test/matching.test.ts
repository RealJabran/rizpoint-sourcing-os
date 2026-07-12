import { describe, expect, it } from "vitest";
import type { CatalogProduct } from "@rizpoint/provider-contracts";
import {
  decideMatch,
  evaluatePackGuard,
  scoreCandidate,
} from "../src/index.js";

const products: Record<string, CatalogProduct> = {
  B000000001: {
    asin: "B000000001",
    title: "Acme Lemon Soda 12 oz Pack of 6",
    brand: "Acme",
    model: "LEMON-12",
    mpn: "LEMON-12",
    sizeText: "12 oz",
    packCount: 6,
    variation: "Lemon",
    identifiers: [{ type: "UPC", value: "012345678905" }],
    provenance: {
      provider: "golden-fixture",
      observedAt: "2026-07-12T00:00:00Z",
      freshnessState: "FRESH",
    },
  },
  B000000002: {
    asin: "B000000002",
    title: "Acme Lemon Soda 12 oz Pack of 12",
    brand: "Acme",
    model: "LEMON-12",
    mpn: "LEMON-12",
    sizeText: "12 oz",
    packCount: 12,
    variation: "Lemon",
    identifiers: [{ type: "UPC", value: "012345678906" }],
    provenance: {
      provider: "golden-fixture",
      observedAt: "2026-07-12T00:00:00Z",
      freshnessState: "FRESH",
    },
  },
};

describe("golden matching decisions", () => {
  it("auto-accepts an exact supplied ASIN with agreeing attributes", () => {
    const candidate = scoreCandidate(
      {
        asin: "B000000001",
        brand: "Acme",
        mpn: "LEMON-12",
        packCount: 6,
        description: "Acme Lemon Soda",
      },
      products.B000000001!,
      "SUPPLIED_ASIN",
    );
    expect(decideMatch([candidate]).status).toBe("AUTO_ACCEPTED");
  });

  it("never auto-accepts a pack or brand contradiction", () => {
    const candidate = scoreCandidate(
      {
        upc: "012345678906",
        brand: "Acme",
        mpn: "LEMON-12",
        packCount: 6,
        description: "Acme Lemon Soda",
      },
      products.B000000002!,
      "EXACT_IDENTIFIER",
    );
    expect(candidate.hasHardContradiction).toBe(true);
    expect(decideMatch([candidate]).status).toBe("REVIEW_REQUIRED");
  });

  it("auto-accepts an exact UPC when no hard feature contradicts it", () => {
    const candidate = scoreCandidate(
      { upc: "012345678905" },
      products.B000000001!,
      "EXACT_IDENTIFIER",
    );
    expect(decideMatch([candidate]).status).toBe("AUTO_ACCEPTED");
  });

  it("scores an MPN plus brand candidate without using title-only confidence", () => {
    const candidate = scoreCandidate(
      { mpn: "LEMON-12", brand: "Acme", packCount: 6 },
      products.B000000001!,
      "MPN_BRAND",
    );
    expect(
      candidate.evidence.find((item) => item.feature === "IDENTIFIER")
        ?.reasonCode,
    ).toBe("IDENTIFIER_EXACT");
    expect(decideMatch([candidate]).status).toBe("AUTO_ACCEPTED");
  });

  it("requires review for explicit size and variation contradictions", () => {
    const candidate = scoreCandidate(
      {
        upc: "012345678905",
        brand: "Acme",
        mpn: "LEMON-12",
        packCount: 6,
        sizeText: "16 oz",
        variation: "Lime",
      },
      products.B000000001!,
      "EXACT_IDENTIFIER",
    );
    expect(
      candidate.evidence.find((item) => item.feature === "SIZE")?.outcome,
    ).toBe("CONTRADICTION");
    expect(
      candidate.evidence.find((item) => item.feature === "VARIATION")?.outcome,
    ).toBe("CONTRADICTION");
    expect(decideMatch([candidate]).status).toBe("REVIEW_REQUIRED");
  });

  it("returns unmatched below the review threshold", () => {
    const candidate = scoreCandidate(
      { description: "unrelated item" },
      products.B000000001!,
      "TITLE_SEARCH",
    );
    expect(decideMatch([candidate]).status).toBe("UNMATCHED");
  });
});

describe("PackGuard", () => {
  it("verifies complete pack conversion with Decimal cost", () => {
    expect(
      evaluatePackGuard({
        supplierUnitsPerCase: 12,
        amazonUnitsPerPack: 6,
        supplierUnitCost: "2.50",
      }),
    ).toMatchObject({
      status: "VERIFIED",
      sellableUnitsPerCase: 2,
      costPerSellableUnit: "15.0000",
    });
  });

  it("blocks unknown and contradictory pack data", () => {
    expect(
      evaluatePackGuard({
        supplierUnitsPerCase: null,
        amazonUnitsPerPack: 6,
        supplierUnitCost: "2.50",
      }).status,
    ).toBe("BLOCKED_PACK_UNCERTAIN");
    expect(
      evaluatePackGuard({
        supplierUnitsPerCase: 10,
        amazonUnitsPerPack: 6,
        supplierUnitCost: "2.50",
      }).status,
    ).toBe("BLOCKED_PACK_CONTRADICTION");
  });
});
