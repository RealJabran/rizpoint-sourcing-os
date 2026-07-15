import {
  buildScenarios,
  decide,
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

type Observation = {
  metricType: "CATALOG" | "PRICING" | "FEES" | "RESTRICTIONS" | "HISTORY";
  provider: string;
  observedAt: Date;
  freshUntil: Date;
  freshnessState: "FRESH" | "STALE" | "EXPIRED" | "UNKNOWN";
  currency: string | null;
  primaryAmount: { toString(): string } | null;
  quotedPrice: { toString(): string } | null;
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
  const values = (observation?.payload as { value?: unknown[] }).value;
  return values?.length ?? 0;
}

function feeQuote(observation: Observation | null): FeeQuote | null {
  const value = (
    observation?.payload as {
      value?: {
        totalFee?: string;
        quotedPrice?: string;
        currency?: string;
        model?: {
          fixedFee?: string;
          percentageOfPrice?: string;
          minimumFee?: string;
        };
      };
    }
  ).value;
  if (
    !observation ||
    !value?.totalFee ||
    !value.quotedPrice ||
    !value.currency ||
    !value.model?.fixedFee ||
    !value.model.percentageOfPrice
  ) {
    return null;
  }
  if (
    !observation.quotedPrice ||
    !new Decimal(observation.quotedPrice.toString()).eq(value.quotedPrice)
  ) {
    return null;
  }
  return {
    totalFee: value.totalFee,
    quotedPrice: value.quotedPrice,
    currency: value.currency,
    provider: observation.provider,
    observedAt: observation.observedAt.toISOString(),
    freshUntil: observation.freshUntil.toISOString(),
    freshnessState: observation.freshnessState,
    model: {
      fixedFee: value.model.fixedFee,
      percentageOfPrice: value.model.percentageOfPrice,
      ...(value.model.minimumFee ? { minimumFee: value.model.minimumFee } : {}),
    },
  };
}

function restrictionStatus(observation: Observation | null) {
  const status = (observation?.payload as { value?: { status?: string } }).value
    ?.status;
  return status === "ALLOWED" ||
    status === "REQUIRES_APPROVAL" ||
    status === "RESTRICTED"
    ? status
    : "UNKNOWN";
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
  let partial = run.routes.length === 0;
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
    const current = priceEvidence(newestObservation(observations, "PRICING"));
    const history = newestObservation(observations, "HISTORY");
    const conservative = conservativePriceEvidence(history);
    const fees = feeQuote(newestObservation(observations, "FEES"));
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
      const matchVerified = isProfitVerifiedMatch({
        status: row.matchDecision?.status,
        reasonCodes: row.matchDecision?.reasonCodes,
      });
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
        eligibility,
        brandPolicy,
        packGuard,
        route: {
          id: route.id,
          name: route.name,
          effectiveFrom: route.effectiveFrom.toISOString(),
        },
        calculatedAt: calculatedAt.toISOString(),
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
        currencyMismatch
      ) {
        partial = true;
        results.push({
          supplierRowId: row.id,
          shippingRouteId: route.id,
          status: "PARTIAL_SUCCESS",
          recommendation: !candidate ? "REVIEW_MATCH" : "INSUFFICIENT_DATA",
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
              stressDiscountPercent:
                override?.stressDiscountPercent?.toString() ??
                run.financialPolicy.stressDiscountPercent.toString(),
            },
            override: override
              ? {
                  id: override.id,
                  revision: override.revision,
                  reason: override.reason,
                }
              : null,
          }),
          evidence: json(evidence),
          reasonCodes: json(
            !candidate
              ? ["MATCH_REQUIRED"]
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
        costs: overriddenCosts,
        stressDiscountPercent:
          override?.stressDiscountPercent?.toString() ??
          run.financialPolicy.stressDiscountPercent.toString(),
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
      const completed =
        currentProfit.status === "CALCULATED" &&
        conservativeProfit.status === "CALCULATED" &&
        stressProfit.status === "CALCULATED";
      partial ||= !completed;
      const currentExact = currentProfit.exactValues;
      const conservativeExact = conservativeProfit.exactValues;
      const stressExact = stressProfit.exactValues;
      results.push({
        supplierRowId: row.id,
        shippingRouteId: route.id,
        status: completed ? "COMPLETED" : "PARTIAL_SUCCESS",
        recommendation: decision.recommendation,
        ...(currentExact
          ? {
              currentNetProfit: currentExact.netProfit,
              effectiveCogs: currentExact.effectiveCogs,
              amazonFees: currentExact.amazonFees,
            }
          : {}),
        ...(conservativeExact
          ? { conservativeNetProfit: conservativeExact.netProfit }
          : {}),
        ...(stressExact ? { stressNetProfit: stressExact.netProfit } : {}),
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
              }
            : null,
        }),
        evidence: json({ ...evidence, scenarios, decision }),
        reasonCodes: json([
          ...currentProfit.reasonCodes,
          ...conservativeProfit.reasonCodes,
          ...stressProfit.reasonCodes,
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
