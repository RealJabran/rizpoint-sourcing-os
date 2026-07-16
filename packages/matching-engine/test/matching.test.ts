import { describe, expect, it } from "vitest";
import type { CatalogProduct } from "@rizpoint/provider-contracts";
import {
  decideMatch,
  evaluatePackGuard,
  extractSupplierPackCount,
  extractSupplierUnitsPerCase,
  isValidIdentifier,
  matchingIdentifiers,
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
    identifiers: [{ type: "UPC", value: "012345678912" }],
    provenance: {
      provider: "golden-fixture",
      observedAt: "2026-07-12T00:00:00Z",
      freshnessState: "FRESH",
    },
  },
};

describe("golden matching decisions", () => {
  it("preserves a leading-zero UPC and accepts a valid exact identifier", () => {
    expect(matchingIdentifiers({ upc: "012345678905" })).toEqual([
      { type: "UPC", value: "012345678905" },
    ]);
    const candidate = scoreCandidate(
      { upc: "012345678905" },
      products.B000000001!,
      "EXACT_IDENTIFIER",
    );
    expect(decideMatch([candidate]).status).toBe("AUTO_ACCEPTED");
  });

  it("does not query or score invalid UPC/EAN/GTIN values as exact identifiers", () => {
    expect(isValidIdentifier("ASIN", "not-an-asin")).toBe(false);
    expect(isValidIdentifier("UPC", "012345678906")).toBe(false);
    expect(isValidIdentifier("EAN", "4006381333931")).toBe(true);
    expect(isValidIdentifier("EAN", "4006381333932")).toBe(false);
    expect(isValidIdentifier("GTIN", "00012345600012")).toBe(true);
    expect(matchingIdentifiers({ upc: "012345678906" })).toEqual([]);
    expect(matchingIdentifiers({ asin: "not-an-asin" })).toEqual([]);
    const candidate = scoreCandidate(
      { upc: "012345678906" },
      products.B000000001!,
      "EXACT_IDENTIFIER",
    );
    expect(candidate.confidence).toBe(0);
    expect(decideMatch([candidate]).status).toBe("UNMATCHED");
  });

  it("requires review for an ambiguous pair of exact candidates", () => {
    const duplicateIdentifier: CatalogProduct = {
      ...products.B000000002!,
      identifiers: [{ type: "UPC", value: "012345678905" }],
    };
    const input = { upc: "012345678905" };
    expect(
      decideMatch([
        scoreCandidate(input, products.B000000001!, "EXACT_IDENTIFIER"),
        scoreCandidate(input, duplicateIdentifier, "EXACT_IDENTIFIER"),
      ]),
    ).toMatchObject({
      status: "REVIEW_REQUIRED",
      reasonCodes: ["AMBIGUOUS_CANDIDATES"],
    });
  });

  it("routes a strong title candidate to human review, never auto-accept", () => {
    const candidate = scoreCandidate(
      { description: "Acme Lemon Soda 12 oz Pack of 6", brand: "Acme" },
      products.B000000001!,
      "TITLE_SEARCH",
    );
    expect(candidate.confidence).toBeGreaterThanOrEqual(80);
    expect(decideMatch([candidate]).status).toBe("REVIEW_REQUIRED");
  });

  it("extracts a description pack contradiction before auto-accepting an exact UPC", () => {
    const candidate = scoreCandidate(
      { upc: "012345678912", description: "Acme Lemon Soda pack of 6" },
      products.B000000002!,
      "EXACT_IDENTIFIER",
    );
    expect(
      candidate.evidence.find((item) => item.feature === "PACK")?.outcome,
    ).toBe("CONTRADICTION");
    expect(decideMatch([candidate]).status).toBe("REVIEW_REQUIRED");
  });

  it("does not double-count an MPN as model evidence", () => {
    const candidate = scoreCandidate(
      { mpn: "LEMON-12", brand: "Acme", packCount: 6 },
      products.B000000001!,
      "MPN_BRAND",
    );
    expect(
      candidate.evidence.find((item) => item.feature === "MODEL"),
    ).toMatchObject({ outcome: "NOT_APPLICABLE" });
    expect(decideMatch([candidate]).status).toBe("REVIEW_REQUIRED");
  });

  it("does not treat a supplier SKU as manufacturer model evidence", () => {
    const candidate = scoreCandidate(
      {
        asin: "B000000001",
        itemNumber: "VSI-SUPPLIER-SKU-001",
        brand: "Acme",
      },
      products.B000000001!,
      "SUPPLIED_ASIN",
    );
    expect(
      candidate.evidence.find((item) => item.feature === "MODEL"),
    ).toMatchObject({ outcome: "UNKNOWN" });
    expect(decideMatch([candidate]).status).toBe("AUTO_ACCEPTED");
  });

  it("requires review for brand, model, size, variation, and pack contradictions", () => {
    const candidate = scoreCandidate(
      {
        upc: "012345678905",
        brand: "OtherBrand",
        itemNumber: "OTHER-MODEL",
        packCount: 12,
        sizeText: "16 oz",
        variation: "Lime",
      },
      products.B000000001!,
      "EXACT_IDENTIFIER",
    );
    expect(candidate.hasHardContradiction).toBe(true);
    expect(decideMatch([candidate]).status).toBe("REVIEW_REQUIRED");
  });

  it("returns unmatched for a weak title", () => {
    const candidate = scoreCandidate(
      { description: "unrelated item" },
      products.B000000001!,
      "TITLE_SEARCH",
    );
    expect(decideMatch([candidate]).status).toBe("UNMATCHED");
  });
});

describe("supplier packaging extraction", () => {
  it("keeps consumer packs and units per case distinct", () => {
    expect(extractSupplierPackCount("Acme pack of 6")).toBe(6);
    expect(extractSupplierUnitsPerCase("Acme 12/cs")).toBe(12);
    expect(extractSupplierUnitsPerCase("inventory quantity 96")).toBeNull();
  });
});

describe("PackGuard", () => {
  it("verifies complete explicit case conversion with Decimal cost", () => {
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

  it("blocks unknown, contradictory, and invalid cost inputs", () => {
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
    expect(
      evaluatePackGuard({
        supplierUnitsPerCase: 12,
        amazonUnitsPerPack: 6,
        supplierUnitCost: "-2.50",
      }).reasonCode,
    ).toBe("SUPPLIER_COST_INVALID");
  });
});
