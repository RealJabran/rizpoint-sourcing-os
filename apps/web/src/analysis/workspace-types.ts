export const ANALYSIS_GROUPS = [
  "identity",
  "decision",
  "economics",
  "risk",
] as const;
export type AnalysisGroup = (typeof ANALYSIS_GROUPS)[number];
export type DecimalValue = string | { toString(): string };
export type ExternalEvidence = {
  provider: string;
  observedAt: string;
  freshUntil: string;
  freshnessState: string;
  value: string | null;
  currency: string | null;
  restrictionStatus: string | null;
} | null;
export type AnalysisRow = {
  id: string;
  status: string;
  recommendation: string | null;
  currentNetProfit: DecimalValue | null;
  conservativeNetProfit: DecimalValue | null;
  stressNetProfit: DecimalValue | null;
  userEnteredNetProfit: DecimalValue | null;
  effectiveCogs: DecimalValue | null;
  amazonFees: DecimalValue | null;
  roiPercent: DecimalValue | null;
  marginPercent: DecimalValue | null;
  breakEvenPrice: DecimalValue | null;
  reasonCodes: string[];
  supplierRow: {
    sourceRowNumber: number;
    normalizedOffer: {
      asin: string | null;
      upc: string | null;
      ean: string | null;
      gtin: string | null;
      itemNumber: string | null;
      mpn: string | null;
      description: string | null;
      brand: string | null;
      unitCost: DecimalValue | null;
      currency: string | null;
      quantity: number | null;
      caseCount: number | null;
      packCount: number | null;
    } | null;
    warnings: Array<{ code: string }>;
    matchDecision: {
      status: string;
      confidence: number;
      selectedCandidate: {
        catalogProduct: {
          asin: string | null;
          title: string;
          brand: string | null;
          model: string | null;
          mpn: string | null;
          sizeText: string | null;
          variation: string | null;
          provider: string;
          observedAt: string;
          freshnessState: string;
          packCount?: number | null;
          identity: {
            manufacturer: string | null;
            color: string | null;
            productTypes: string[];
            variationTheme: string | null;
            images: Array<{ url: string; variant: string | null }>;
          };
        };
        packGuard: { status: string; reasonCode: string } | null;
      } | null;
    } | null;
    profitCostOverrides: Array<{
      revision: number;
      status: string;
      stressDiscountPercent: { toString(): string } | null;
      userEnteredSalePrice: { toString(): string } | null;
      values: Array<{ field: string; value: { toString(): string } }>;
    }>;
  };
  externalEvidence: {
    pricing: ExternalEvidence;
    fees: ExternalEvidence;
    restrictions: ExternalEvidence;
  };
  feeEstimate: {
    completeness: string | null;
    scenarioSource: string | null;
    observedAt: string;
    expiresAt: string;
    freshnessState: string;
    components: Array<{ type: string; finalFee: string; currency: string }>;
  } | null;
  feeScenarios: Array<{
    scenarioSource: string | null;
    scenarioPrice: string | null;
    completeness: string | null;
    freshnessState: string;
  }>;
  offerIntelligence: {
    provider: string;
    observedAt: string;
    expiresAt: string;
    freshnessState: string;
    completeness: string | null;
    featuredOffer: {
      state: string | null;
      price: string | null;
      currency: string | null;
      fulfillmentChannel: string | null;
    };
    amazonRetailPresence: string | null;
    counts: {
      total: { value: number | null; completeness: string | null };
      fba: { value: number | null; completeness: string | null };
      fbm: { value: number | null; completeness: string | null };
    };
    lowestFbaPrice: string | null;
    lowestFbmPrice: string | null;
  } | null;
  listingRestriction: {
    state: string;
    completeness: string | null;
    reasonCodes: string[];
    observedAt: string;
    expiresAt: string;
    freshnessState: string;
  } | null;
};
export type AnalysisRoute = { id: string; name: string; currency: string };
export type AnalysisScanContext = {
  id: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  supplier: { code: string; name: string } | null;
  upload: { originalFilename: string; status: string } | null;
  rowCount: number;
  checkpoints: Array<{ stage: string; updatedAt: string }>;
  recoverableErrors: Array<{ status: string; observedAt: string }>;
};
export type AnalysisDetail = Record<string, unknown> & {
  id: string;
  engineVersion: string;
  reasonCodes: string[];
  inputSnapshot: unknown;
  evidence: unknown;
  supplierRow: Record<string, unknown>;
};
