import assert from "node:assert/strict";
import { Decimal } from "decimal.js";
import {
  CATEGORY_AGGREGATION_VERSION,
  COMPLIANCE_SCREEN_VERSION,
  DIFFERENTIATION_SUMMARY_VERSION,
  KEYWORD_NORMALIZATION_VERSION,
  KEYWORD_RANK_ANALYTICS_VERSION,
  NICHE_AGGREGATION_VERSION,
  NICHE_OPPORTUNITY_SCORE_VERSION,
  REVERSE_ASIN_GAP_VERSION,
  REVIEW_CLUSTERING_VERSION,
  aggregateCategoryRows,
  calculateKeywordRankAnalytics,
  calculateNicheOpportunityScore,
  calculateReverseAsinKeywordGap,
  clusterReviewThemes,
  evaluateProviderExportRights,
  hypothesisFor,
  normalizeResearchPhrase,
  sanitizeCopilotQuestion,
  screenComplianceRisk,
  selectCopilotOperation,
  type CategoryAggregateRow,
  type KeywordRankAnalyticsObservation,
  type NicheScoreInputRow,
  type ReverseAsinGapObservation,
  type ScreeningRule,
} from "@rizpoint/database";
import {
  HISTORY_ANALYTICS_VERSION,
  analyzeHistory,
  type HistoryAnalyticsInput,
} from "@rizpoint/history-analytics";
import {
  PORTFOLIO_OPTIMIZER_VERSION,
  optimizePortfolio,
  type PortfolioCandidateInput,
  type PortfolioConstraints,
} from "@rizpoint/portfolio-optimizer";
import {
  PRIVATE_LABEL_ENGINE_VERSION,
  PROFIT_ENGINE_VERSION,
  calculatePrivateLabelScenario,
  calculateProfit,
  type PrivateLabelScenarioInput,
  type ProfitInput,
} from "@rizpoint/profit-engine";
import {
  SALES_ESTIMATION_ENGINE_VERSION,
  backtestModel,
  estimateWithCalibratedModel,
  type CalibratedSalesModel,
  type SalesEstimationInput,
} from "@rizpoint/sales-estimation";
import {
  keywordMetricSchema,
  ProviderError,
  type MarketplaceContext,
  type ProviderCapability,
} from "@rizpoint/provider-contracts";
import { normalizeFeeComponents } from "@rizpoint/amazon-sp-api";
import { KeepaMarketHistoryProvider } from "@rizpoint/keepa-api";
import metricsFixture from "./fixtures/metrics.v1.json" with { type: "json" };
import aiFixture from "./fixtures/ai.v1.json" with { type: "json" };
import providerFixture from "./fixtures/providers.v1.json" with { type: "json" };
import {
  evaluateEvidenceGrounding,
  type EvaluationAnswer,
  type EvaluationEvidence,
} from "./ai-grounding.js";

export { evaluateEvidenceGrounding } from "./ai-grounding.js";

export type EvaluationCaseResult = {
  id: string;
  suite: "METRIC" | "AI" | "PROVIDER";
  passed: boolean;
  error?: string;
};

export type ResearchEvaluationReport = {
  benchmarkVersion: "research-accuracy-benchmark/v1";
  generatedAt: string;
  datasets: string[];
  caseCount: number;
  passedCount: number;
  failedCount: number;
  passed: boolean;
  salesQuality: {
    sampleSize: number;
    mae: string | null;
    mapePercent: string | null;
    intervalCoveragePercent: string | null;
    thresholds: Record<string, string>;
    passed: boolean;
  };
  cases: EvaluationCaseResult[];
};

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  assert(value && typeof value === "object" && !Array.isArray(value));
  return value as JsonRecord;
}

function projectExpected(actual: unknown, expected: unknown): unknown {
  if (Array.isArray(expected)) {
    assert(Array.isArray(actual), "Expected an array from production formula");
    assert.equal(
      actual.length,
      expected.length,
      "Production output changed the expected array cardinality",
    );
    return expected.map((item, index) => projectExpected(actual[index], item));
  }
  if (expected && typeof expected === "object") {
    const actualRecord = record(actual);
    return Object.fromEntries(
      Object.entries(expected as JsonRecord).map(([key, value]) => {
        assert(
          Object.hasOwn(actualRecord, key),
          `Production output omitted expected key ${key}`,
        );
        return [key, projectExpected(actualRecord[key], value)];
      }),
    );
  }
  return actual;
}

function assertGolden(actual: unknown, expected: unknown) {
  assert.deepStrictEqual(projectExpected(actual, expected), expected);
}

async function capture(
  results: EvaluationCaseResult[],
  suite: EvaluationCaseResult["suite"],
  id: string,
  evaluate: () => unknown | Promise<unknown>,
) {
  try {
    await evaluate();
    results.push({ id, suite, passed: true });
  } catch (error) {
    results.push({
      id,
      suite,
      passed: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const productionFormulaVersions = {
  productHistory: HISTORY_ANALYTICS_VERSION,
  seasonality: HISTORY_ANALYTICS_VERSION,
  opportunityScoring: NICHE_OPPORTUNITY_SCORE_VERSION,
  nicheAggregation: NICHE_AGGREGATION_VERSION,
  categoryAggregation: CATEGORY_AGGREGATION_VERSION,
  keywordNormalization: KEYWORD_NORMALIZATION_VERSION,
  reverseAsinGap: REVERSE_ASIN_GAP_VERSION,
  rankTracking: KEYWORD_RANK_ANALYTICS_VERSION,
  salesEstimation: SALES_ESTIMATION_ENGINE_VERSION,
  reviewClustering: REVIEW_CLUSTERING_VERSION,
  differentiationSummary: DIFFERENTIATION_SUMMARY_VERSION,
  profitability: PROFIT_ENGINE_VERSION,
  privateLabelProfitability: PRIVATE_LABEL_ENGINE_VERSION,
  complianceClassification: COMPLIANCE_SCREEN_VERSION,
  portfolioOptimization: PORTFOLIO_OPTIMIZER_VERSION,
};

function categoryRows(): CategoryAggregateRow[] {
  const rows = metricsFixture.category.rows;
  const decimalValue = (value: string | null) =>
    value === null ? null : { toString: () => value };
  return rows.map((row) => ({
    ...row,
    price: decimalValue(row.price),
    reviewCount: row.reviewCount === null ? null : BigInt(row.reviewCount),
    priceVolatilityPercent: decimalValue(row.priceVolatilityPercent),
    priceVolatility30Percent: decimalValue(row.priceVolatility30Percent),
    reviewGrowth: decimalValue(row.reviewGrowth),
    reviewGrowth30: decimalValue(row.reviewGrowth30),
    listingAgeDays: decimalValue(row.listingAgeDays),
    opportunityScore: decimalValue(row.opportunityScore),
    observedAt: row.observedAt === null ? null : new Date(row.observedAt),
  }));
}

async function runMetricCases(results: EvaluationCaseResult[]) {
  await capture(results, "METRIC", "formula-version-registry", () =>
    assert.deepStrictEqual(
      productionFormulaVersions,
      metricsFixture.formulaVersions,
    ),
  );
  await capture(results, "METRIC", "product-history", () =>
    assertGolden(
      analyzeHistory(metricsFixture.history.input as HistoryAnalyticsInput),
      metricsFixture.history.expected,
    ),
  );
  await capture(results, "METRIC", "seasonality", () =>
    assertGolden(
      analyzeHistory(metricsFixture.seasonality.input as HistoryAnalyticsInput),
      metricsFixture.seasonality.expected,
    ),
  );
  const nicheResult = calculateNicheOpportunityScore(
    metricsFixture.nicheRows as NicheScoreInputRow[],
  );
  await capture(results, "METRIC", "opportunity-scoring", () =>
    assertGolden(nicheResult, metricsFixture.opportunityExpected),
  );
  await capture(results, "METRIC", "niche-aggregation", () =>
    assertGolden(nicheResult, metricsFixture.nicheAggregateExpected),
  );
  await capture(results, "METRIC", "category-aggregation", () =>
    assertGolden(
      aggregateCategoryRows(categoryRows()),
      metricsFixture.category.expected,
    ),
  );
  await capture(results, "METRIC", "keyword-normalization", () => {
    const original = metricsFixture.keywordNormalization.original;
    assert.equal(
      normalizeResearchPhrase(original),
      metricsFixture.keywordNormalization.expectedNormalized,
    );
    assert.equal(original, metricsFixture.keywordNormalization.original);
  });
  await capture(results, "METRIC", "reverse-asin-gap", () =>
    assertGolden(
      calculateReverseAsinKeywordGap({
        asins: metricsFixture.reverseAsin.asins,
        mineAsin: metricsFixture.reverseAsin.mineAsin,
        observations: metricsFixture.reverseAsin
          .observations as ReverseAsinGapObservation[],
      }),
      metricsFixture.reverseAsin.expected,
    ),
  );
  await capture(results, "METRIC", "rank-tracking", () =>
    assertGolden(
      calculateKeywordRankAnalytics(
        metricsFixture.rankTracking
          .observations as KeywordRankAnalyticsObservation[],
      ),
      metricsFixture.rankTracking.expected,
    ),
  );
  await capture(results, "METRIC", "sales-estimation", () =>
    assertGolden(
      estimateWithCalibratedModel(
        metricsFixture.salesEstimation.input as SalesEstimationInput,
        metricsFixture.salesEstimation.model as CalibratedSalesModel,
      ),
      metricsFixture.salesEstimation.expected,
    ),
  );
  await capture(results, "METRIC", "review-clustering", () =>
    assertGolden(
      clusterReviewThemes(metricsFixture.reviews.input),
      metricsFixture.reviews.expected,
    ),
  );
  await capture(results, "METRIC", "differentiation-summary", () =>
    assertGolden(
      hypothesisFor(metricsFixture.differentiation.input),
      metricsFixture.differentiation.expected,
    ),
  );
  await capture(results, "METRIC", "profitability", () =>
    assertGolden(
      calculateProfit({
        ...(metricsFixture.profitability.input as ProfitInput),
        calculatedAt: new Date(metricsFixture.profitability.calculatedAt),
      }),
      metricsFixture.profitability.expected,
    ),
  );
  await capture(results, "METRIC", "private-label-profitability", () =>
    assertGolden(
      calculatePrivateLabelScenario(
        metricsFixture.privateLabelProfitability
          .input as PrivateLabelScenarioInput,
      ),
      metricsFixture.privateLabelProfitability.expected,
    ),
  );
  await capture(results, "METRIC", "compliance-classification", () => {
    const ruleSet = metricsFixture.compliance.ruleSet;
    const rules = metricsFixture.compliance.rules.map((rule) => ({
      ...rule,
      sourcePublishedAt: new Date(rule.sourcePublishedAt),
    })) as ScreeningRule[];
    const output = screenComplianceRisk({
      text: metricsFixture.compliance.inputText,
      rules,
      ruleSet: {
        ...ruleSet,
        sourcePublishedAt: new Date(ruleSet.sourcePublishedAt),
        sourceAccessedAt: new Date(ruleSet.sourceAccessedAt),
      },
    });
    const selected = metricsFixture.compliance.expected.map((expected) =>
      output.find((item) => item.domain === expected.domain),
    );
    assertGolden(selected, metricsFixture.compliance.expected);
  });
  await capture(results, "METRIC", "portfolio-optimization", () =>
    assertGolden(
      optimizePortfolio({
        candidates: metricsFixture.portfolio
          .candidates as PortfolioCandidateInput[],
        constraints: metricsFixture.portfolio
          .constraints as PortfolioConstraints,
      }),
      metricsFixture.portfolio.expected,
    ),
  );
}

async function runAiCases(results: EvaluationCaseResult[]) {
  for (const testCase of aiFixture.cases)
    await capture(results, "AI", testCase.id, () =>
      assertGolden(
        evaluateEvidenceGrounding({
          evidence: aiFixture.evidence as EvaluationEvidence[],
          answer: testCase.answer as EvaluationAnswer,
          ...(testCase.requiredMissingData
            ? { requiredMissingData: testCase.requiredMissingData }
            : {}),
        }),
        testCase.expected,
      ),
    );
  await capture(results, "AI", "prompt-injection", () => {
    const sanitized = sanitizeCopilotQuestion(aiFixture.promptInjection.input);
    assert.equal(
      selectCopilotOperation(aiFixture.promptInjection.input),
      aiFixture.promptInjection.expectedOperation,
    );
    assert.equal(
      sanitized.match(/\[redacted\]/g)?.length ?? 0,
      aiFixture.promptInjection.expectedRedactionCount,
    );
  });
}

function keepaResponse(body: unknown, status = 200, headers = new Headers()) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
    json: async () => body,
  };
}

async function runProviderCases(results: EvaluationCaseResult[]) {
  const marketplace = providerFixture.marketplace as MarketplaceContext;
  const request = {
    asins: providerFixture.keepa.requestedAsins,
    historyDays: 365,
    includeRatingAndReviews: true,
  };
  await capture(results, "PROVIDER", "recorded-contract-complete", async () => {
    const provider = new KeepaMarketHistoryProvider(
      { apiKey: "synthetic-test-key" },
      async () => keepaResponse(providerFixture.keepa.completePayload),
      () => new Date("2026-06-30T00:00:00.000Z"),
    );
    const output = await provider.getProductHistory(request, marketplace);
    assert.equal(output.value.products.length, 2);
    assert.equal(output.provenance.responseCompleteness, "COMPLETE");
    assert.equal(
      output.value.products[0]?.series.find(
        (series) => series.metricKey === "AMAZON_PRICE",
      )?.points[0]?.decimalValue,
      "19.99",
    );
  });
  await capture(results, "PROVIDER", "partial-provider-payload", async () => {
    const provider = new KeepaMarketHistoryProvider(
      { apiKey: "synthetic-test-key" },
      async () => keepaResponse(providerFixture.keepa.partialPayload),
    );
    const output = await provider.getProductHistory(request, marketplace);
    assert.equal(output.value.products.length, 1);
    assert.equal(output.provenance.responseCompleteness, "PARTIAL");
  });
  await capture(results, "PROVIDER", "schema-drift", async () => {
    const provider = new KeepaMarketHistoryProvider(
      { apiKey: "synthetic-test-key" },
      async () => keepaResponse(providerFixture.keepa.driftedPayload),
    );
    const output = await provider.getProductHistory(request, marketplace);
    assert.equal(output.value.products.length, 0);
    assert.equal(output.provenance.responseCompleteness, "PARTIAL");
    assert.equal(
      keywordMetricSchema.safeParse(providerFixture.keywordContracts.drifted)
        .success,
      false,
    );
  });
  await capture(results, "PROVIDER", "throttling", async () => {
    const provider = new KeepaMarketHistoryProvider(
      { apiKey: "synthetic-test-key" },
      async () =>
        keepaResponse(
          {},
          providerFixture.throttle.status,
          new Headers({ "retry-after": providerFixture.throttle.retryAfter }),
        ),
    );
    try {
      await provider.getProductHistory(request, marketplace);
      assert.fail("Throttled provider response unexpectedly succeeded");
    } catch (error) {
      assert(error instanceof ProviderError);
      assert.equal(error.code, providerFixture.throttle.expectedCode);
      assert.equal(
        error.options.retryAfterMs,
        providerFixture.throttle.expectedRetryAfterMs,
      );
    }
  });
  await capture(results, "PROVIDER", "fee-contract-complete", () => {
    const output = normalizeFeeComponents(
      providerFixture.feeComponents.complete,
    );
    assert.equal(output.complete, true);
    assert.equal(output.components.length, 2);
  });
  await capture(results, "PROVIDER", "fee-contract-drift", () => {
    const output = normalizeFeeComponents(
      providerFixture.feeComponents.drifted,
    );
    assert.equal(output.complete, false);
    assert.equal(output.components.length, 0);
  });
  await capture(results, "PROVIDER", "normalized-contract-valid", () =>
    assert.equal(
      keywordMetricSchema.safeParse(providerFixture.keywordContracts.valid)
        .success,
      true,
    ),
  );
  await capture(results, "PROVIDER", "entitlement-failure", () => {
    const entitlement = providerFixture.entitlement;
    const decision = evaluateProviderExportRights({
      request: {
        ...entitlement.request,
        capability: entitlement.request.capability as ProviderCapability,
      },
      rights: null,
    });
    assert.equal(decision.decision, entitlement.expectedDecision);
    assert.deepStrictEqual(decision.allowedFields, []);
  });
}

function salesQuality() {
  const output = backtestModel(metricsFixture.salesEstimation.backtestCases);
  assertGolden(output, metricsFixture.salesEstimation.expectedBacktest);
  const thresholds = metricsFixture.salesEstimation.qualityGate;
  const passed =
    output.mae !== null &&
    output.mapePercent !== null &&
    output.intervalCoveragePercent !== null &&
    new Decimal(output.mae).lte(thresholds.maximumMae) &&
    new Decimal(output.mapePercent).lte(thresholds.maximumMapePercent) &&
    new Decimal(output.intervalCoveragePercent).gte(
      thresholds.minimumIntervalCoveragePercent,
    );
  return { ...output, thresholds, passed };
}

export async function runResearchEvaluation(): Promise<ResearchEvaluationReport> {
  const cases: EvaluationCaseResult[] = [];
  await runMetricCases(cases);
  await runAiCases(cases);
  await runProviderCases(cases);
  const quality = salesQuality();
  await capture(cases, "METRIC", "sales-estimation-quality-gate", () =>
    assert.equal(quality.passed, true),
  );
  const failedCount = cases.filter((item) => !item.passed).length;
  return {
    benchmarkVersion: "research-accuracy-benchmark/v1",
    generatedAt: new Date().toISOString(),
    datasets: [
      metricsFixture.datasetVersion,
      aiFixture.datasetVersion,
      providerFixture.datasetVersion,
    ],
    caseCount: cases.length,
    passedCount: cases.length - failedCount,
    failedCount,
    passed: failedCount === 0 && quality.passed,
    salesQuality: quality,
    cases,
  };
}
