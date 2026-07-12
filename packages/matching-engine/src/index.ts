import {
  money,
  type MatchDecisionStatus,
  type PackGuardStatus,
} from "@rizpoint/domain";
import type {
  CatalogIdentifier,
  CatalogProduct,
} from "@rizpoint/provider-contracts";

export type CandidateSource =
  "SUPPLIED_ASIN" | "EXACT_IDENTIFIER" | "MPN_BRAND" | "TITLE_SEARCH";
export type EvidenceFeature =
  "IDENTIFIER" | "BRAND" | "MODEL" | "SIZE" | "PACK" | "VARIATION" | "TITLE";
export type EvidenceOutcome =
  "AGREEMENT" | "CONTRADICTION" | "UNKNOWN" | "NOT_APPLICABLE";

export interface SupplierMatchInput {
  readonly asin?: string | null;
  readonly upc?: string | null;
  readonly ean?: string | null;
  readonly gtin?: string | null;
  readonly mpn?: string | null;
  readonly itemNumber?: string | null;
  readonly description?: string | null;
  readonly brand?: string | null;
  readonly sizeText?: string | null;
  readonly variation?: string | null;
  readonly packCount?: number | null;
  readonly caseCount?: number | null;
  readonly quantity?: number | null;
  readonly unitCost?: string | null;
}

export interface MatchEvidence {
  readonly feature: EvidenceFeature;
  readonly outcome: EvidenceOutcome;
  readonly score: number;
  readonly reasonCode: string;
  readonly details: Readonly<Record<string, string | number | null>>;
}

export interface ScoredCandidate {
  readonly product: CatalogProduct;
  readonly source: CandidateSource;
  readonly confidence: number;
  readonly evidence: readonly MatchEvidence[];
  readonly hasHardContradiction: boolean;
}

export interface MatchDecisionProposal {
  readonly status: Extract<
    MatchDecisionStatus,
    "AUTO_ACCEPTED" | "REVIEW_REQUIRED" | "UNMATCHED"
  >;
  readonly confidence: number;
  readonly selected: ScoredCandidate | null;
  readonly reasonCodes: readonly string[];
}

export interface PackGuardInput {
  readonly supplierUnitsPerCase: number | null;
  readonly amazonUnitsPerPack: number | null;
  readonly supplierUnitCost: string | null;
}

export interface PackGuardResult {
  readonly status: PackGuardStatus;
  readonly supplierUnitsPerCase: number | null;
  readonly amazonUnitsPerPack: number | null;
  readonly sellableUnitsPerCase: number | null;
  readonly remainderUnits: number | null;
  readonly costPerSellableUnit: string | null;
  readonly reasonCode: string;
}

const AUTO_ACCEPT_THRESHOLD = 95;
const REVIEW_THRESHOLD = 80;

export function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeIdentifier(
  value: string | null | undefined,
): string | null {
  const normalized = (value ?? "").trim().toUpperCase().replace(/[\s-]/g, "");
  return normalized || null;
}

export function matchingIdentifiers(
  input: SupplierMatchInput,
): readonly CatalogIdentifier[] {
  const values: Array<[CatalogIdentifier["type"], string | null | undefined]> =
    [
      ["ASIN", input.asin],
      ["UPC", input.upc],
      ["EAN", input.ean],
      ["GTIN", input.gtin],
      ["MPN", input.mpn],
    ];
  return values.flatMap(([type, value]) => {
    const normalized = normalizeIdentifier(value);
    return normalized ? [{ type, value: normalized }] : [];
  });
}

function tokenSet(value: string | null | undefined): Set<string> {
  return new Set(
    normalizeText(value)
      .split(" ")
      .filter((token) => token.length > 1),
  );
}

function titleSimilarity(
  left: string | null | undefined,
  right: string,
): number {
  const leftTokens = tokenSet(left);
  const rightTokens = tokenSet(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  const overlap = [...leftTokens].filter((token) =>
    rightTokens.has(token),
  ).length;
  return Math.round(
    (overlap * 100) / Math.max(leftTokens.size, rightTokens.size),
  );
}

function feature(
  name: EvidenceFeature,
  supplierValue: string | number | null | undefined,
  catalogValue: string | number | null | undefined,
  agreementScore: number,
): MatchEvidence {
  if (
    supplierValue == null ||
    supplierValue === "" ||
    catalogValue == null ||
    catalogValue === ""
  ) {
    return {
      feature: name,
      outcome: "UNKNOWN",
      score: 0,
      reasonCode: `${name}_UNKNOWN`,
      details: {
        supplierValue: supplierValue ?? null,
        catalogValue: catalogValue ?? null,
      },
    };
  }
  const same =
    typeof supplierValue === "number" || typeof catalogValue === "number"
      ? supplierValue === catalogValue
      : normalizeText(String(supplierValue)) ===
        normalizeText(String(catalogValue));
  return same
    ? {
        feature: name,
        outcome: "AGREEMENT",
        score: agreementScore,
        reasonCode: `${name}_AGREEMENT`,
        details: { supplierValue, catalogValue },
      }
    : {
        feature: name,
        outcome: "CONTRADICTION",
        score: 0,
        reasonCode: `${name}_CONTRADICTION`,
        details: { supplierValue, catalogValue },
      };
}

function identifierEvidence(
  input: SupplierMatchInput,
  product: CatalogProduct,
): MatchEvidence {
  const candidateIdentifiers = new Set(
    product.identifiers.map(
      (identifier) =>
        `${identifier.type}:${normalizeIdentifier(identifier.value)}`,
    ),
  );
  const exact = matchingIdentifiers(input).find(
    (identifier) =>
      (identifier.type === "ASIN" &&
        normalizeIdentifier(product.asin) === identifier.value) ||
      (identifier.type === "MPN" &&
        normalizeIdentifier(product.mpn) === identifier.value) ||
      candidateIdentifiers.has(`${identifier.type}:${identifier.value}`),
  );
  if (exact)
    return {
      feature: "IDENTIFIER",
      outcome: "AGREEMENT",
      score: exact.type === "ASIN" ? 100 : exact.type === "MPN" ? 60 : 95,
      reasonCode: "IDENTIFIER_EXACT",
      details: { identifierType: exact.type, identifierValue: exact.value },
    };
  return {
    feature: "IDENTIFIER",
    outcome: "UNKNOWN",
    score: 0,
    reasonCode: "IDENTIFIER_NOT_SHARED",
    details: {},
  };
}

function extractedSize(description: string | null | undefined): string | null {
  const match = (description ?? "").match(
    /\b(\d+(?:\.\d+)?)\s*(fl\.?\s*oz|oz|ml|g|kg|lb|ct|count)\b/i,
  );
  return match ? `${match[1]} ${match[2]}` : null;
}

export function scoreCandidate(
  input: SupplierMatchInput,
  product: CatalogProduct,
  source: CandidateSource,
): ScoredCandidate {
  const identifier = identifierEvidence(input, product);
  const brand = feature("BRAND", input.brand, product.brand, 15);
  const model = feature(
    "MODEL",
    input.mpn ?? input.itemNumber,
    product.mpn ?? product.model,
    15,
  );
  const pack = feature(
    "PACK",
    input.packCount ?? input.caseCount,
    product.packCount,
    10,
  );
  const size = feature(
    "SIZE",
    input.sizeText ?? extractedSize(input.description),
    product.sizeText,
    10,
  );
  const variation = feature("VARIATION", input.variation, product.variation, 5);
  const similarity = titleSimilarity(input.description, product.title);
  const title: MatchEvidence = {
    feature: "TITLE",
    outcome:
      similarity >= 60
        ? "AGREEMENT"
        : similarity === 0
          ? "UNKNOWN"
          : "CONTRADICTION",
    score: Math.round((similarity * 10) / 100),
    reasonCode: similarity >= 60 ? "TITLE_SIMILAR" : "TITLE_WEAK",
    details: { similarity },
  };
  const evidence = [identifier, brand, model, size, pack, variation, title];
  const hardFeatures: EvidenceFeature[] = [
    "BRAND",
    "MODEL",
    "SIZE",
    "PACK",
    "VARIATION",
  ];
  const hasHardContradiction = evidence.some(
    (item) =>
      hardFeatures.includes(item.feature) && item.outcome === "CONTRADICTION",
  );
  const confidence =
    source === "SUPPLIED_ASIN" && identifier.outcome === "AGREEMENT"
      ? 100
      : Math.min(
          100,
          evidence.reduce((total, item) => total + item.score, 0),
        );
  return { product, source, confidence, evidence, hasHardContradiction };
}

export function decideMatch(
  candidates: readonly ScoredCandidate[],
): MatchDecisionProposal {
  const selected =
    [...candidates].sort(
      (left, right) => right.confidence - left.confidence,
    )[0] ?? null;
  if (!selected)
    return {
      status: "UNMATCHED",
      confidence: 0,
      selected: null,
      reasonCodes: ["NO_CANDIDATES"],
    };
  if (selected.hasHardContradiction)
    return {
      status: "REVIEW_REQUIRED",
      confidence: selected.confidence,
      selected,
      reasonCodes: [
        "HARD_CONTRADICTION",
        ...selected.evidence
          .filter((item) => item.outcome === "CONTRADICTION")
          .map((item) => item.reasonCode),
      ],
    };
  if (selected.confidence >= AUTO_ACCEPT_THRESHOLD)
    return {
      status: "AUTO_ACCEPTED",
      confidence: selected.confidence,
      selected,
      reasonCodes: ["AUTO_ACCEPT_THRESHOLD_MET"],
    };
  if (selected.confidence >= REVIEW_THRESHOLD)
    return {
      status: "REVIEW_REQUIRED",
      confidence: selected.confidence,
      selected,
      reasonCodes: ["REVIEW_CONFIDENCE_RANGE"],
    };
  return {
    status: "UNMATCHED",
    confidence: selected.confidence,
    selected: null,
    reasonCodes: ["CONFIDENCE_BELOW_REVIEW_THRESHOLD"],
  };
}

export function evaluatePackGuard(input: PackGuardInput): PackGuardResult {
  const supplierUnits = input.supplierUnitsPerCase;
  const amazonUnits = input.amazonUnitsPerPack;
  if (!supplierUnits || !amazonUnits || supplierUnits < 1 || amazonUnits < 1) {
    return {
      status: "BLOCKED_PACK_UNCERTAIN",
      supplierUnitsPerCase: supplierUnits,
      amazonUnitsPerPack: amazonUnits,
      sellableUnitsPerCase: null,
      remainderUnits: null,
      costPerSellableUnit: null,
      reasonCode: "PACK_INPUT_UNKNOWN",
    };
  }
  const sellable = Math.floor(supplierUnits / amazonUnits);
  const remainder = supplierUnits % amazonUnits;
  if (remainder !== 0) {
    return {
      status: "BLOCKED_PACK_CONTRADICTION",
      supplierUnitsPerCase: supplierUnits,
      amazonUnitsPerPack: amazonUnits,
      sellableUnitsPerCase: sellable,
      remainderUnits: remainder,
      costPerSellableUnit: null,
      reasonCode: "PACK_REMAINDER",
    };
  }
  if (!input.supplierUnitCost) {
    return {
      status: "BLOCKED_PACK_UNCERTAIN",
      supplierUnitsPerCase: supplierUnits,
      amazonUnitsPerPack: amazonUnits,
      sellableUnitsPerCase: sellable,
      remainderUnits: 0,
      costPerSellableUnit: null,
      reasonCode: "SUPPLIER_COST_UNKNOWN",
    };
  }
  return {
    status: "VERIFIED",
    supplierUnitsPerCase: supplierUnits,
    amazonUnitsPerPack: amazonUnits,
    sellableUnitsPerCase: sellable,
    remainderUnits: 0,
    costPerSellableUnit: money(input.supplierUnitCost)
      .mul(amazonUnits)
      .toFixed(4),
    reasonCode: "PACK_VERIFIED",
  };
}
