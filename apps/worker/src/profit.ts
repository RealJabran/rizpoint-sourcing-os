import {
  buildScenarios,
  decide,
  deriveStressPrice,
  PROFIT_ENGINE_VERSION,
  type DecisionInput,
  type FeeQuote,
  type PriceEvidence,
} from "@rizpoint/profit-engine";
import {
  getProfitCalculationForProcessing,
  isProfitVerifiedMatch,
  markProfitCalculationRunning,
  persistProfitCalculation,
} from "@rizpoint/database";
import type { Prisma } from "@rizpoint/database";
import { Decimal } from "decimal.js";
import {
  ensureExactFeeQuote,
  findExactFeeQuote,
  type StoredFeeObservation,
} from "./fee-scenarios.js";

type Observation = {
  metricType: "CATALOG" | "PRICING" | "FEES" | "RESTRICTIONS" | "HISTORY";
  provider: string;
  observedAt: Date;
  freshUntil: Date;
  freshnessState: "FRESH" | "STALE" | "EXPIRED" | "UNKNOWN";
  currency: string | null;
  primaryAmount: { toString(): string } | null;
  quotedPrice: { toString(): string } | null;
  completeness: "COMPLETE" | "PARTIAL" | "UNKNOWN" | null;
  observationStatus:
    | "SUCCESS"
    | "PARTIAL"
    | "UNAUTHORIZED"
    | "THROTTLED"
    | "RETRYABLE_FAILURE"
    | "TERMINAL_FAILURE"
    | "UNAVAILABLE";
  feeScenarioSource:
    "CURRENT_FEATURED_OFFER" | "CONSERVATIVE" | "USER_ENTERED" | null;
  feeFulfillment: "AMAZON" | "MERCHANT" | "UNKNOWN" | null;
  featuredFulfillment: "AMAZON" | "MERCHANT" | "UNKNOWN" | null;
  restrictionState:
    | "ELIGIBLE"
    | "RESTRICTED"
    | "APPROVAL_REQUIRED"
    | "INCOMPLETE"
    | "UNAUTHORIZED"
    | "THROTTLED"
    | "UNKNOWN"
    | null;
  feeComponents: Array<{
    feeType: string;
    parentFeeType: string | null;
    currency: string;
    finalFee: { toString(): string };
  }>;
  payload: unknown;
};

function newestObservation(
  observations: readonly Observation[],
  metricType: Observation["metricType"],
): Observation | null {
  return (
    observations
      .filter((observation) => observation.metricType === metricType)
      .sort(
        (left, right) => right.observedAt.getTime() - left.observedAt.getTime(),
      )[0] ?? null
  );
}

function priceEvidence(observation: Observation | null): PriceEvidence | null {
  if (!observation?.primaryAmount || !observation.currency) return null;
  return {
    price: observation.primaryAmount.toString(),
    currency: observation.currency,
    provider: observation.provider,
    observedAt: observation.observedAt.toISOString(),
    freshUntil: observation.freshUntil.toISOString(),
    freshnessState: observation.freshnessState,
  };
}

function conservativePriceEvidence(
  observation: Observation | null,
): PriceEvidence | null {
  if (!observation || !observation.currency) return null;
  const values = (observation.payload as { value?: Array<{ price?: string }> })
    .value;
  const prices =
    values
      ?.map((value) => value.price)
      .filter((value): value is string => typeof value === "string") ?? [];
  if (prices.length === 0) return null;
  const conservative = prices.reduce((lowest, value) =>
    new Decimal(value).lt(new Decimal(lowest)) ? value : lowest,
  );
  return {
    price: conservative,
    currency: observation.currency,
    provider: observation.provider,
    observedAt: observation.observedAt.toISOString(),
    freshUntil: observation.freshUntil.toISOString(),
    freshnessState: observation.freshnessState,
  };
}

function historyObservationCount(observation: Observation | null): number {
  if (!observation) return 0;
  const values = (observation.payload as { value?: unknown[] }).value;
  return values?.length ?? 0;
}

function restrictionStatus(observation: Observation | null) {
  if (!observation) return "UNKNOWN" as const;
  if (observation.observationStatus === "UNAUTHORIZED")
    return "UNAUTHORIZED" as const;
  if (observation.observationStatus === "THROTTLED")
    return "THROTTLED" as const;
  if (
    observation.observationStatus !== "SUCCESS" ||
    observation.completeness !== "COMPLETE" ||
    observation.freshnessState !== "FRESH" ||
    observation.freshUntil.getTime() < Date.now()
  )
    return "INCOMPLETE" as const;
  return observation.restrictionState ?? "UNKNOWN";
}

function costInputs(
  route: {
    allocatedSupplierFreight: { toString(): string };
    prepFee: { toString(): string };
    labelingFee: { toString(): string };
    polybagFee: { toString(): string };
    bundleFee: { toString(): string };
    bubblewrapFee: { toString(): string };
    inboundShipping: { toString(): string };
    dutyOrTax: { toString(): string };
    storageAllowance: { toString(): string };
    returnAllowance: { toString(): string };
    otherCosts: { toString(): string };
  },
  supplierCost: string,
) {
  return {
    supplierCostPerSellableUnit: supplierCost,
    allocatedSupplierFreight: route.allocatedSupplierFreight.toString(),
    prepFee: route.prepFee.toString(),
    labelingFee: route.labelingFee.toString(),
    polybagFee: route.polybagFee.toString(),
    bundleFee: route.bundleFee.toString(),
    bubblewrapFee: route.bubblewrapFee.toString(),
    inboundShipping: route.inboundShipping.toString(),
    dutyOrTax: route.dutyOrTax.toString(),
    storageAllowance: route.storageAllowance.toString(),
    returnAllowance: route.returnAllowance.toString(),
    otherCosts: route.otherCosts.toString(),
  };
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

const overrideFieldToCost = {
  SUPPLIER_COST_PER_SELLABLE_UNIT: "supplierCostPerSellableUnit",
  ALLOCATED_SUPPLIER_FREIGHT: "allocatedSupplierFreight",
  PREP_FEE: "prepFee",
  LABELING_FEE: "labelingFee",
  POLYBAG_FEE: "polybagFee",
  BUNDLE_FEE: "bundleFee",
  BUBBLEWRAP_FEE: "bubblewrapFee",
  INBOUND_SHIPPING: "inboundShipping",
  DUTY_OR_TAX: "dutyOrTax",
  STORAGE_ALLOWANCE: "storageAllowance",
  RETURN_ALLOWANCE: "returnAllowance",
  OTHER_COSTS: "otherCosts",
} as const;

export async function processProfitCalculation(runId: string) {
  const run = await getProfitCalculationForProcessing(runId);
  if (!run || !(await markProfitCalculationRunning(run.id))) return;
  const results: Parameters<typeof persistProfitCalculation>[0]["results"] = [];
  const policyVersionMismatch =
    run.financialPolicy.engineVersion !== PROFIT_ENGINE_VERSION;
  let partial = run.routes.length === 0 || policyVersionMismatch;
  const targetKeys = new Set(
    run.targets.map(
      (target) => `${target.supplierRowId}:${target.shippingRouteId}`,
    ),
  );
  for (const row of run.scanJob.supplierRows) {
    if (
      run.scope === "TARGETED" &&
      !run.targets.some((target) => target.supplierRowId === row.id)
    )
      continue;
    const observations = row.enrichmentItems.flatMap(
      (item) => item.observations,
    ) as Observation[];
    const candidate = row.matchDecision?.selectedCandidate;
    const packGuard = candidate?.packGuard;
    const pricingObservation = newestObservation(observations, "PRICING");
    const current = priceEvidence(pricingObservation);
    const history = newestObservation(observations, "HISTORY");
    const conservative = conservativePriceEvidence(history);
    const eligibility = restrictionStatus(
      newestObservation(observations, "RESTRICTIONS"),
    );
    const brand = candidate?.catalogProduct.brand;
    const storedBrandPolicy = brand
      ? run.organization.brandPolicies.find((policy) => policy.brand === brand)
      : null;
    const brandPolicy =
      storedBrandPolicy?.expiresAt &&
      storedBrandPolicy.expiresAt.getTime() < Date.now()
        ? "UNKNOWN"
        : (storedBrandPolicy?.status ?? "UNKNOWN");
    for (const route of run.routes) {
      if (run.scope === "TARGETED" && !targetKeys.has(`${row.id}:${route.id}`))
        continue;
      const override = row.profitCostOverrides.find(
        (candidate) => candidate.shippingRouteId === route.id,
      );
      const baseCosts = costInputs(
        route,
        packGuard?.costPerSellableUnit?.toString() ?? "0",
      );
      const overriddenCosts = { ...baseCosts };
      for (const value of override?.values ?? []) {
        const target =
          overrideFieldToCost[value.field as keyof typeof overrideFieldToCost];
        if (target) overriddenCosts[target] = value.value.toString();
      }
      const calculatedAt = new Date();
      const stressDiscountPercent =
        override?.stressDiscountPercent?.toString() ??
        run.financialPolicy.stressDiscountPercent.toString();
      const userEntered = override?.userEnteredSalePrice
        ? {
            price: override.userEnteredSalePrice.toString(),
            currency: run.financialPolicy.currency,
            provider: "user-entered",
            observedAt: override.updatedAt.toISOString(),
            freshUntil: new Date(
              calculatedAt.getTime() + 60 * 60_000,
            ).toISOString(),
            freshnessState: "FRESH" as const,
          }
        : undefined;
      const matchVerified = isProfitVerifiedMatch({
        status: row.matchDecision?.status,
        reasonCodes: row.matchDecision?.reasonCodes,
      });
      const feeItem = candidate
        ? row.enrichmentItems.find(
            (item) => item.asin === candidate.catalogProduct.asin,
          )
        : undefined;
      const fulfillmentChannel =
        observations
          .filter(
            (observation) =>
              observation.metricType === "FEES" &&
              observation.feeScenarioSource === "CURRENT_FEATURED_OFFER" &&
              observation.feeFulfillment !== "UNKNOWN",
          )
          .sort(
            (left, right) =>
              right.observedAt.getTime() - left.observedAt.getTime(),
          )[0]?.feeFulfillment ?? pricingObservation?.featuredFulfillment;
      const canRequestFees =
        !policyVersionMismatch &&
        matchVerified &&
        packGuard?.status === "VERIFIED" &&
        Boolean(packGuard.costPerSellableUnit) &&
        Boolean(feeItem) &&
        (fulfillmentChannel === "AMAZON" ||
          fulfillmentChannel === "MERCHANT") &&
        route.currency === run.financialPolicy.currency;
      let fees = current
        ? findExactFeeQuote(
            observations as StoredFeeObservation[],
            "CURRENT_FEATURED_OFFER",
            current.price,
            current.currency,
            fulfillmentChannel as "AMAZON" | "MERCHANT",
            calculatedAt,
          )
        : null;
      if (
        !fees &&
        canRequestFees &&
        feeItem &&
        current?.currency === run.financialPolicy.currency
      )
        fees = await ensureExactFeeQuote({
          organizationId: run.organizationId,
          calculationAttempt: run.attemptCount,
          item: feeItem,
          observations: observations as StoredFeeObservation[],
          scenarioSource: "CURRENT_FEATURED_OFFER",
          price: current.price,
          currency: current.currency,
          fulfillmentChannel: fulfillmentChannel as "AMAZON" | "MERCHANT",
          calculatedAt,
        });
      let conservativeFees: FeeQuote | null = fees?.model ? fees : null;
      if (!conservativeFees && conservative) {
        conservativeFees = findExactFeeQuote(
          observations as StoredFeeObservation[],
          "CONSERVATIVE",
          conservative.price,
          conservative.currency,
          fulfillmentChannel as "AMAZON" | "MERCHANT",
          calculatedAt,
        );
        if (
          !conservativeFees &&
          canRequestFees &&
          feeItem &&
          conservative.currency === run.financialPolicy.currency
        )
          conservativeFees = await ensureExactFeeQuote({
            organizationId: run.organizationId,
            calculationAttempt: run.attemptCount,
            item: feeItem,
            observations: observations as StoredFeeObservation[],
            scenarioSource: "CONSERVATIVE",
            price: conservative.price,
            currency: conservative.currency,
            fulfillmentChannel: fulfillmentChannel as "AMAZON" | "MERCHANT",
            calculatedAt,
          });
      }
      let stressFees: FeeQuote | null = fees?.model ? fees : null;
      let stressPrice: string | null = null;
      if (conservative) {
        try {
          stressPrice = deriveStressPrice(
            conservative.price,
            stressDiscountPercent,
          );
        } catch {
          stressPrice = null;
        }
      }
      if (!stressFees && stressPrice && conservative) {
        stressFees = findExactFeeQuote(
          observations as StoredFeeObservation[],
          "CONSERVATIVE",
          stressPrice,
          conservative.currency,
          fulfillmentChannel as "AMAZON" | "MERCHANT",
          calculatedAt,
        );
        if (
          !stressFees &&
          canRequestFees &&
          feeItem &&
          conservative.currency === run.financialPolicy.currency
        )
          stressFees = await ensureExactFeeQuote({
            organizationId: run.organizationId,
            calculationAttempt: run.attemptCount,
            item: feeItem,
            observations: observations as StoredFeeObservation[],
            scenarioSource: "CONSERVATIVE",
            price: stressPrice,
            currency: conservative.currency,
            fulfillmentChannel: fulfillmentChannel as "AMAZON" | "MERCHANT",
            calculatedAt,
          });
      }
      let userEnteredFees: FeeQuote | null = fees?.model ? fees : null;
      if (!userEnteredFees && userEntered) {
        userEnteredFees = findExactFeeQuote(
          observations as StoredFeeObservation[],
          "USER_ENTERED",
          userEntered.price,
          userEntered.currency,
          fulfillmentChannel as "AMAZON" | "MERCHANT",
          calculatedAt,
        );
        if (
          !userEnteredFees &&
          canRequestFees &&
          feeItem &&
          userEntered.currency === run.financialPolicy.currency
        )
          userEnteredFees = await ensureExactFeeQuote({
            organizationId: run.organizationId,
            calculationAttempt: run.attemptCount,
            item: feeItem,
            observations: observations as StoredFeeObservation[],
            scenarioSource: "USER_ENTERED",
            price: userEntered.price,
            currency: userEntered.currency,
            fulfillmentChannel: fulfillmentChannel as "AMAZON" | "MERCHANT",
            calculatedAt,
          });
      }
      const feeQuotes = {
        ...(fees ? { CURRENT: fees } : {}),
        ...(conservativeFees ? { CONSERVATIVE: conservativeFees } : {}),
        ...(stressFees ? { STRESS: stressFees } : {}),
        ...(userEnteredFees ? { USER_ENTERED: userEnteredFees } : {}),
      };
      const demandEvidenceSufficient =
        historyObservationCount(history) >=
        run.financialPolicy.minimumDemandScore;
      const decisionInputs: Omit<
        DecisionInput,
        "currentProfit" | "conservativeProfit" | "stressProfit"
      > = {
        matchVerified,
        sellerEligibility: eligibility,
        brandPolicy,
        demandEvidenceSufficient,
        thresholds: {
          minNetProfit: run.financialPolicy.minNetProfit.toString(),
          minRoiPercent: run.financialPolicy.minRoiPercent.toString(),
          minMarginPercent: run.financialPolicy.minMarginPercent.toString(),
          maxStressLoss: run.financialPolicy.maxStressLoss.toString(),
        },
      };
      const evidence = {
        current,
        conservative,
        fees,
        feeQuotes,
        eligibility,
        brandPolicy,
        packGuard,
        route: {
          id: route.id,
          name: route.name,
          effectiveFrom: route.effectiveFrom.toISOString(),
        },
        calculatedAt: calculatedAt.toISOString(),
        userEntered,
        decisionInputs,
      };
      const currencyMismatch =
        !current ||
        !conservative ||
        !fees ||
        route.currency !== run.financialPolicy.currency ||
        current.currency !== run.financialPolicy.currency ||
        conservative.currency !== run.financialPolicy.currency ||
        fees.currency !== run.financialPolicy.currency;
      if (
        !candidate ||
        !packGuard?.costPerSellableUnit ||
        !current ||
        !conservative ||
        !fees ||
        currencyMismatch ||
        policyVersionMismatch
      ) {
        partial = true;
        results.push({
          supplierRowId: row.id,
          shippingRouteId: route.id,
          status: "PARTIAL_SUCCESS",
          recommendation: !candidate
            ? "REVIEW_MATCH"
            : eligibility === "RESTRICTED"
              ? "AVOID"
              : eligibility === "APPROVAL_REQUIRED"
                ? "REVIEW_APPROVAL"
                : "INSUFFICIENT_DATA",
          engineVersion: PROFIT_ENGINE_VERSION,
          inputSnapshot: json({
            supplierRowId: row.id,
            costs: overriddenCosts,
            policy: {
              id: run.financialPolicy.id,
              currency: run.financialPolicy.currency,
              engineVersion: run.financialPolicy.engineVersion,
              minNetProfit: run.financialPolicy.minNetProfit.toString(),
              minRoiPercent: run.financialPolicy.minRoiPercent.toString(),
              minMarginPercent: run.financialPolicy.minMarginPercent.toString(),
              maxStressLoss: run.financialPolicy.maxStressLoss.toString(),
              stressDiscountPercent,
            },
            override: override
              ? {
                  id: override.id,
                  revision: override.revision,
                  reason: override.reason,
                  userEnteredSalePrice:
                    override.userEnteredSalePrice?.toString() ?? null,
                }
              : null,
          }),
          evidence: json(evidence),
          reasonCodes: json(
            !candidate
              ? ["MATCH_REQUIRED"]
              : eligibility === "RESTRICTED"
                ? ["SELLER_RESTRICTED"]
                : eligibility === "APPROVAL_REQUIRED"
                  ? ["SELLER_APPROVAL_REQUIRED"]
                  : policyVersionMismatch
                    ? ["FORMULA_VERSION_MISMATCH"]
                    : currencyMismatch
                      ? ["CURRENCY_MISMATCH"]
                      : ["MISSING_OR_STALE_EVIDENCE"],
          ),
          ...(override ? { appliedOverrideRevision: override.revision } : {}),
        });
        continue;
      }
      const scenarios = buildScenarios({
        packGuardStatus: packGuard.status,
        current,
        conservative,
        feeQuote: fees,
        feeQuotes,
        costs: overriddenCosts,
        ...(userEntered ? { userEntered } : {}),
        stressDiscountPercent,
        calculatedAt,
      });
      const decision = decide({
        currentProfit: scenarios.CURRENT!,
        conservativeProfit: scenarios.CONSERVATIVE!,
        stressProfit: scenarios.STRESS!,
        ...decisionInputs,
      });
      const currentProfit = scenarios.CURRENT!;
      const conservativeProfit = scenarios.CONSERVATIVE!;
      const stressProfit = scenarios.STRESS!;
      const userEnteredProfit = scenarios.USER_ENTERED;
      const completed =
        currentProfit.status === "CALCULATED" &&
        conservativeProfit.status === "CALCULATED" &&
        stressProfit.status === "CALCULATED" &&
        (!userEnteredProfit || userEnteredProfit.status === "CALCULATED");
      partial ||= !completed;
      const currentExact = currentProfit.exactValues;
      const conservativeExact = conservativeProfit.exactValues;
      const stressExact = stressProfit.exactValues;
      const userEnteredExact = userEnteredProfit?.exactValues;
      results.push({
        supplierRowId: row.id,
        shippingRouteId: route.id,
        status: completed ? "COMPLETED" : "PARTIAL_SUCCESS",
        recommendation: decision.recommendation,
        ...(currentExact
          ? {
              currentNetProfit: currentExact.netProfit,
              currentProceeds: currentExact.proceeds,
              effectiveCogs: currentExact.effectiveCogs,
              amazonFees: currentExact.amazonFees,
            }
          : {}),
        ...(conservativeExact
          ? { conservativeNetProfit: conservativeExact.netProfit }
          : {}),
        ...(stressExact ? { stressNetProfit: stressExact.netProfit } : {}),
        ...(userEnteredExact
          ? { userEnteredNetProfit: userEnteredExact.netProfit }
          : {}),
        ...(currentProfit.roiPercent
          ? { roiPercent: currentProfit.roiPercent }
          : {}),
        ...(currentProfit.marginPercent
          ? { marginPercent: currentProfit.marginPercent }
          : {}),
        ...(currentProfit.breakEvenPrice
          ? { breakEvenPrice: currentProfit.breakEvenPrice }
          : {}),
        engineVersion: PROFIT_ENGINE_VERSION,
        inputSnapshot: json({
          costs: overriddenCosts,
          policy: {
            id: run.financialPolicy.id,
            currency: run.financialPolicy.currency,
            engineVersion: run.financialPolicy.engineVersion,
            minNetProfit: run.financialPolicy.minNetProfit.toString(),
            minRoiPercent: run.financialPolicy.minRoiPercent.toString(),
            minMarginPercent: run.financialPolicy.minMarginPercent.toString(),
            maxStressLoss: run.financialPolicy.maxStressLoss.toString(),
            stressDiscountPercent:
              override?.stressDiscountPercent?.toString() ??
              run.financialPolicy.stressDiscountPercent.toString(),
          },
          override: override
            ? {
                id: override.id,
                revision: override.revision,
                reason: override.reason,
                userEnteredSalePrice:
                  override.userEnteredSalePrice?.toString() ?? null,
              }
            : null,
        }),
        evidence: json({ ...evidence, scenarios, decision }),
        reasonCodes: json([
          ...currentProfit.reasonCodes,
          ...conservativeProfit.reasonCodes,
          ...stressProfit.reasonCodes,
          ...(userEnteredProfit?.reasonCodes ?? []),
          ...decision.reasonCodes,
          ...decision.failedRules,
        ]),
        ...(override ? { appliedOverrideRevision: override.revision } : {}),
      });
    }
  }
  await persistProfitCalculation({
    organizationId: run.organizationId,
    runId: run.id,
    results,
    status: partial ? "PARTIAL_SUCCESS" : "COMPLETED",
  });
}
