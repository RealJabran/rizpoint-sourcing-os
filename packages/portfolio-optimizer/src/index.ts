import { Decimal as DecimalJs } from "decimal.js";

const Decimal = DecimalJs.clone({
  precision: 40,
  rounding: DecimalJs.ROUND_HALF_UP,
  toExpNeg: -100,
  toExpPos: 100,
});

export const PORTFOLIO_OPTIMIZER_VERSION = "portfolio-optimizer/v1";
export const PORTFOLIO_SCENARIOS = [
  "BASE",
  "DEMAND_DOWN_20",
  "PRICE_DOWN_10",
  "FEE_UP_5",
  "DELAYED_REPLENISHMENT",
  "AD_COST_INCREASE",
] as const;
export type PortfolioScenario = (typeof PORTFOLIO_SCENARIOS)[number];
export type RiskBand = "LOW" | "MEDIUM" | "HIGH";
export type ComplianceRisk = "LOW" | "REVIEW" | "HIGH" | "UNKNOWN";
export type DecimalString = string;

export type PortfolioCandidateInput = Readonly<{
  id: string;
  catalogProductId: string;
  asin: string;
  brand: string;
  category: string;
  currency: string;
  unitCost: DecimalString;
  sellingPrice: DecimalString;
  feePerUnit: DecimalString;
  adCostPerUnit: DecimalString;
  moq: number;
  casePack: number;
  expectedMonthlyDemandLow: DecimalString;
  expectedMonthlyDemandHigh: DecimalString;
  netProfitPerUnitLow: DecimalString;
  netProfitPerUnitHigh: DecimalString;
  leadTimeDays: number;
  marginPercent: DecimalString;
  roiPercent: DecimalString;
  confidencePercent: DecimalString;
  seasonalityRisk: RiskBand;
  complianceRisk: ComplianceRisk;
  priceVolatilityPercent: DecimalString;
  competitionRisk: RiskBand;
  targetInventoryDays: number;
  observedAt: string;
  evidenceReferences: readonly string[];
}>;

export type PortfolioConstraints = Readonly<{
  cashBudget: DecimalString;
  currency: string;
  maxAsinExposurePercent: DecimalString;
  maxBrandExposurePercent: DecimalString;
  maxCategoryExposurePercent: DecimalString;
  minMarginPercent: DecimalString;
  minRoiPercent: DecimalString;
  minConfidencePercent: DecimalString;
  maxPriceVolatilityPercent: DecimalString;
  allowedComplianceRisks: readonly ComplianceRisk[];
  maxSeasonalityRisk: RiskBand;
  maxCompetitionRisk: RiskBand;
  maxSearchNodes?: number | undefined;
}>;

export type PortfolioStressAssumptions = Readonly<{
  demandDecreasePercent: DecimalString;
  priceDecreasePercent: DecimalString;
  feeIncreasePercent: DecimalString;
  replenishmentDelayDays: number;
  adCostIncreasePercent: DecimalString;
}>;

export const DEFAULT_PORTFOLIO_STRESS_ASSUMPTIONS: PortfolioStressAssumptions =
  {
    demandDecreasePercent: "20",
    priceDecreasePercent: "10",
    feeIncreasePercent: "5",
    replenishmentDelayDays: 30,
    adCostIncreasePercent: "20",
  };

export type PortfolioConstraintAudit = Readonly<{
  constraint: string;
  limit: string;
  actual: string;
  passed: boolean;
  details: string;
}>;

export type PortfolioAllocation = Readonly<{
  candidateId: string;
  catalogProductId: string;
  asin: string;
  brand: string;
  category: string;
  quantity: number;
  casePack: number;
  moq: number;
  unitCost: DecimalString;
  cashAllocated: DecimalString;
  expectedProfitLow: DecimalString;
  expectedProfitHigh: DecimalString;
  expectedUnitsSoldLow: DecimalString;
  expectedUnitsSoldHigh: DecimalString;
  coverageDays: number;
  evidenceReferences: readonly string[];
}>;

export type PortfolioExclusion = Readonly<{
  candidateId: string;
  asin: string;
  reasons: readonly string[];
}>;

export type PortfolioSolution = Readonly<{
  rank: number;
  allocations: readonly PortfolioAllocation[];
  cashUsed: DecimalString;
  cashRemaining: DecimalString;
  expectedProfitLow: DecimalString;
  expectedProfitHigh: DecimalString;
  productCount: number;
  diversificationScore: DecimalString;
  riskConcentration: Readonly<{
    maxAsinCashPercent: DecimalString;
    maxBrandCashPercent: DecimalString;
    maxCategoryCashPercent: DecimalString;
    cashHhi: DecimalString;
    elevatedRiskCashPercent: DecimalString;
  }>;
  constraintAudit: readonly PortfolioConstraintAudit[];
  excludedProducts: readonly PortfolioExclusion[];
}>;

export type PortfolioScenarioOutput = Readonly<{
  scenario: PortfolioScenario;
  status:
    "CALCULATED" | "NO_FEASIBLE_PORTFOLIO" | "SOLVER_FAILED" | "INVALID_INPUT";
  assumptions: Readonly<Record<string, string>>;
  recommended?: PortfolioSolution | undefined;
  alternatives: readonly PortfolioSolution[];
  reasonCodes: readonly string[];
  searchNodes: number;
  exactOptimal: boolean;
}>;

export type PortfolioOptimizationOutput = Readonly<{
  status:
    | "CALCULATED"
    | "PARTIAL_SUCCESS"
    | "NO_FEASIBLE_PORTFOLIO"
    | "SOLVER_FAILED"
    | "INVALID_INPUT";
  solverVersion: typeof PORTFOLIO_OPTIMIZER_VERSION;
  currency: string;
  scenarios: readonly PortfolioScenarioOutput[];
  reasonCodes: readonly string[];
}>;

const decimalPattern = /^-?\d+(?:\.\d+)?$/;
const riskRank: Record<RiskBand, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };
const MAX_CANDIDATES = 24;
const MAX_OPTIONS_PER_CANDIDATE = 200;
const DEFAULT_MAX_SEARCH_NODES = 500_000;
const MAX_SEARCH_NODES = 2_000_000;

type D = InstanceType<typeof Decimal>;
type Prepared = {
  input: PortfolioCandidateInput;
  unitCost: D;
  sellingPrice: D;
  profitLow: D;
  profitHigh: D;
  demandLow: D;
  demandHigh: D;
  coverageDays: number;
  minimumLot: number;
  quantities: number[];
  conservativeReturnOnCash: D;
};
type SearchAllocation = {
  candidate: Prepared;
  quantity: number;
  cash: D;
  profitLow: D;
  profitHigh: D;
  unitsLow: D;
  unitsHigh: D;
};
type SearchSolution = {
  allocations: SearchAllocation[];
  cash: D;
  profitLow: D;
  profitHigh: D;
  key: string;
};

function decimal(value: string, code = "INVALID_DECIMAL_INPUT") {
  if (!decimalPattern.test(value)) throw new Error(code);
  return new Decimal(value);
}
function fixed(value: D, places = 4) {
  return value.toDecimalPlaces(places, Decimal.ROUND_HALF_UP).toFixed(places);
}
function money(value: D) {
  return fixed(value, 4);
}
function percent(value: D) {
  return fixed(value, 4);
}
function percentageOf(amount: D, percentage: D) {
  return amount.mul(percentage).div(100);
}
function validPercentage(value: D) {
  return value.gte(0) && value.lte(100);
}
function roundUpToMultiple(value: number, multiple: number) {
  return Math.ceil(value / multiple) * multiple;
}
function roundDownToMultiple(value: number, multiple: number) {
  return Math.floor(value / multiple) * multiple;
}
function uniqueStrings(values: readonly string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function validate(input: {
  candidates: readonly PortfolioCandidateInput[];
  constraints: PortfolioConstraints;
  stressAssumptions: PortfolioStressAssumptions;
}) {
  const { candidates, constraints, stressAssumptions } = input;
  if (!/^[A-Z]{3}$/.test(constraints.currency))
    throw new Error("INVALID_PORTFOLIO_CURRENCY");
  const budget = decimal(constraints.cashBudget, "INVALID_CASH_BUDGET");
  if (!budget.gt(0)) throw new Error("NON_POSITIVE_CASH_BUDGET");
  if (!candidates.length) throw new Error("PORTFOLIO_CANDIDATES_REQUIRED");
  if (candidates.length > MAX_CANDIDATES)
    throw new Error("TOO_MANY_PORTFOLIO_CANDIDATES");
  const percentages = [
    constraints.maxAsinExposurePercent,
    constraints.maxBrandExposurePercent,
    constraints.maxCategoryExposurePercent,
    constraints.minMarginPercent,
    constraints.minRoiPercent,
    constraints.minConfidencePercent,
    constraints.maxPriceVolatilityPercent,
    stressAssumptions.demandDecreasePercent,
    stressAssumptions.priceDecreasePercent,
    stressAssumptions.feeIncreasePercent,
    stressAssumptions.adCostIncreasePercent,
  ].map((value) => decimal(value));
  if (percentages.some((value) => !validPercentage(value)))
    throw new Error("PORTFOLIO_PERCENTAGE_OUT_OF_RANGE");
  if (!constraints.allowedComplianceRisks.length)
    throw new Error("ALLOWED_COMPLIANCE_RISKS_REQUIRED");
  if (
    !Number.isSafeInteger(stressAssumptions.replenishmentDelayDays) ||
    stressAssumptions.replenishmentDelayDays < 0 ||
    stressAssumptions.replenishmentDelayDays > 365
  )
    throw new Error("INVALID_REPLENISHMENT_DELAY");
  const nodeLimit = constraints.maxSearchNodes ?? DEFAULT_MAX_SEARCH_NODES;
  if (
    !Number.isSafeInteger(nodeLimit) ||
    nodeLimit < 1_000 ||
    nodeLimit > MAX_SEARCH_NODES
  )
    throw new Error("INVALID_SEARCH_NODE_LIMIT");
  const ids = new Set<string>();
  for (const candidate of candidates) {
    if (
      !candidate.id.trim() ||
      !candidate.catalogProductId.trim() ||
      !candidate.asin.trim() ||
      !candidate.brand.trim() ||
      !candidate.category.trim() ||
      candidate.currency !== constraints.currency ||
      !Number.isSafeInteger(candidate.moq) ||
      candidate.moq <= 0 ||
      !Number.isSafeInteger(candidate.casePack) ||
      candidate.casePack <= 0 ||
      !Number.isSafeInteger(candidate.leadTimeDays) ||
      candidate.leadTimeDays < 0 ||
      !Number.isSafeInteger(candidate.targetInventoryDays) ||
      candidate.targetInventoryDays <= 0 ||
      Number.isNaN(new Date(candidate.observedAt).getTime()) ||
      !uniqueStrings(candidate.evidenceReferences).length
    )
      throw new Error(`INVALID_CANDIDATE_HEADER:${candidate.id || "UNKNOWN"}`);
    if (ids.has(candidate.id)) throw new Error("DUPLICATE_CANDIDATE_ID");
    ids.add(candidate.id);
    const unitCost = decimal(candidate.unitCost);
    const sellingPrice = decimal(candidate.sellingPrice);
    const fee = decimal(candidate.feePerUnit);
    const ad = decimal(candidate.adCostPerUnit);
    const demandLow = decimal(candidate.expectedMonthlyDemandLow);
    const demandHigh = decimal(candidate.expectedMonthlyDemandHigh);
    const profitLow = decimal(candidate.netProfitPerUnitLow);
    const profitHigh = decimal(candidate.netProfitPerUnitHigh);
    const margin = decimal(candidate.marginPercent);
    const roi = decimal(candidate.roiPercent);
    const confidence = decimal(candidate.confidencePercent);
    const volatility = decimal(candidate.priceVolatilityPercent);
    if (
      !unitCost.gt(0) ||
      !sellingPrice.gt(0) ||
      fee.lt(0) ||
      ad.lt(0) ||
      demandLow.lt(0) ||
      demandHigh.lt(demandLow) ||
      profitHigh.lt(profitLow) ||
      !validPercentage(confidence) ||
      !validPercentage(volatility) ||
      margin.lt(-100) ||
      roi.lt(-100)
    )
      throw new Error(`INVALID_CANDIDATE_VALUES:${candidate.id}`);
  }
  return { budget, nodeLimit };
}

function scenarioAssumptions(
  scenario: PortfolioScenario,
  stress: PortfolioStressAssumptions,
) {
  const common = { calculation: "targetInventoryDays + leadTimeDays" };
  if (scenario === "DEMAND_DOWN_20")
    return { ...common, demandDecreasePercent: stress.demandDecreasePercent };
  if (scenario === "PRICE_DOWN_10")
    return { ...common, priceDecreasePercent: stress.priceDecreasePercent };
  if (scenario === "FEE_UP_5")
    return { ...common, feeIncreasePercent: stress.feeIncreasePercent };
  if (scenario === "DELAYED_REPLENISHMENT")
    return {
      ...common,
      replenishmentDelayDays: String(stress.replenishmentDelayDays),
    };
  if (scenario === "AD_COST_INCREASE")
    return { ...common, adCostIncreasePercent: stress.adCostIncreasePercent };
  return { ...common, stress: "none" };
}

function prepareCandidate(
  candidate: PortfolioCandidateInput,
  scenario: PortfolioScenario,
  constraints: PortfolioConstraints,
  budget: D,
  stress: PortfolioStressAssumptions,
): { prepared?: Prepared; reasons: string[] } {
  const reasons: string[] = [];
  const unitCost = decimal(candidate.unitCost);
  let sellingPrice = decimal(candidate.sellingPrice);
  let profitLow = decimal(candidate.netProfitPerUnitLow);
  let profitHigh = decimal(candidate.netProfitPerUnitHigh);
  let demandLow = decimal(candidate.expectedMonthlyDemandLow);
  let demandHigh = decimal(candidate.expectedMonthlyDemandHigh);
  let coverageDays = candidate.targetInventoryDays + candidate.leadTimeDays;
  if (scenario === "DEMAND_DOWN_20") {
    const multiplier = new Decimal(1).minus(
      decimal(stress.demandDecreasePercent).div(100),
    );
    demandLow = demandLow.mul(multiplier);
    demandHigh = demandHigh.mul(multiplier);
  } else if (scenario === "PRICE_DOWN_10") {
    const priceLoss = sellingPrice.mul(
      decimal(stress.priceDecreasePercent).div(100),
    );
    sellingPrice = sellingPrice.minus(priceLoss);
    profitLow = profitLow.minus(priceLoss);
    profitHigh = profitHigh.minus(priceLoss);
  } else if (scenario === "FEE_UP_5") {
    const feeIncrease = decimal(candidate.feePerUnit).mul(
      decimal(stress.feeIncreasePercent).div(100),
    );
    profitLow = profitLow.minus(feeIncrease);
    profitHigh = profitHigh.minus(feeIncrease);
  } else if (scenario === "DELAYED_REPLENISHMENT") {
    coverageDays += stress.replenishmentDelayDays;
  } else if (scenario === "AD_COST_INCREASE") {
    const adIncrease = decimal(candidate.adCostPerUnit).mul(
      decimal(stress.adCostIncreasePercent).div(100),
    );
    profitLow = profitLow.minus(adIncrease);
    profitHigh = profitHigh.minus(adIncrease);
  }
  const scenarioMargin = profitLow.div(sellingPrice).mul(100);
  const scenarioRoi = profitLow.div(unitCost).mul(100);
  if (!constraints.allowedComplianceRisks.includes(candidate.complianceRisk))
    reasons.push(`COMPLIANCE_RISK_${candidate.complianceRisk}_NOT_ALLOWED`);
  if (
    riskRank[candidate.seasonalityRisk] >
    riskRank[constraints.maxSeasonalityRisk]
  )
    reasons.push("SEASONALITY_RISK_EXCEEDS_LIMIT");
  if (
    riskRank[candidate.competitionRisk] >
    riskRank[constraints.maxCompetitionRisk]
  )
    reasons.push("COMPETITION_RISK_EXCEEDS_LIMIT");
  if (
    decimal(candidate.priceVolatilityPercent).gt(
      decimal(constraints.maxPriceVolatilityPercent),
    )
  )
    reasons.push("PRICE_VOLATILITY_EXCEEDS_LIMIT");
  if (
    decimal(candidate.confidencePercent).lt(
      decimal(constraints.minConfidencePercent),
    )
  )
    reasons.push("CONFIDENCE_BELOW_MINIMUM");
  if (
    Decimal.min(decimal(candidate.marginPercent), scenarioMargin).lt(
      decimal(constraints.minMarginPercent),
    )
  )
    reasons.push("MARGIN_BELOW_MINIMUM");
  if (
    Decimal.min(decimal(candidate.roiPercent), scenarioRoi).lt(
      decimal(constraints.minRoiPercent),
    )
  )
    reasons.push("ROI_BELOW_MINIMUM");
  if (!profitLow.gt(0)) reasons.push("NON_POSITIVE_CONSERVATIVE_PROFIT");
  const minimumLot = roundUpToMultiple(candidate.moq, candidate.casePack);
  const maxDemandUnits = demandHigh
    .mul(coverageDays)
    .div(30)
    .floor()
    .toNumber();
  const maxByDemand = roundDownToMultiple(maxDemandUnits, candidate.casePack);
  const maxAsinCash = percentageOf(
    budget,
    decimal(constraints.maxAsinExposurePercent),
  );
  const maxByAsin = roundDownToMultiple(
    maxAsinCash.div(unitCost).floor().toNumber(),
    candidate.casePack,
  );
  const maxByBudget = roundDownToMultiple(
    budget.div(unitCost).floor().toNumber(),
    candidate.casePack,
  );
  const maximumQuantity = Math.min(maxByDemand, maxByAsin, maxByBudget);
  if (minimumLot > maxByDemand) reasons.push("MOQ_EXCEEDS_DEMAND_COVERAGE");
  if (minimumLot > maxByAsin) reasons.push("MOQ_EXCEEDS_ASIN_EXPOSURE_LIMIT");
  if (minimumLot > maxByBudget) reasons.push("MOQ_EXCEEDS_CASH_BUDGET");
  if (reasons.length) return { reasons };
  const optionCount = (maximumQuantity - minimumLot) / candidate.casePack + 1;
  if (optionCount > MAX_OPTIONS_PER_CANDIDATE)
    throw new Error(`CANDIDATE_OPTION_SPACE_EXCEEDED:${candidate.id}`);
  const quantities: number[] = [];
  for (
    let quantity = maximumQuantity;
    quantity >= minimumLot;
    quantity -= candidate.casePack
  )
    quantities.push(quantity);
  quantities.push(0);
  return {
    reasons,
    prepared: {
      input: candidate,
      unitCost,
      sellingPrice,
      profitLow,
      profitHigh,
      demandLow,
      demandHigh,
      coverageDays,
      minimumLot,
      quantities,
      conservativeReturnOnCash: profitLow.div(unitCost),
    },
  };
}

function allocationAt(candidate: Prepared, quantity: number): SearchAllocation {
  const quantityDecimal = new Decimal(quantity);
  const lowCapacity = candidate.demandLow.mul(candidate.coverageDays).div(30);
  const highCapacity = candidate.demandHigh.mul(candidate.coverageDays).div(30);
  const unitsLow = Decimal.min(quantityDecimal, lowCapacity);
  const unitsHigh = Decimal.min(quantityDecimal, highCapacity);
  return {
    candidate,
    quantity,
    cash: candidate.unitCost.mul(quantityDecimal),
    profitLow: candidate.profitLow.mul(unitsLow),
    profitHigh: candidate.profitHigh.mul(unitsHigh),
    unitsLow,
    unitsHigh,
  };
}

function solutionComparator(a: SearchSolution, b: SearchSolution) {
  const low = b.profitLow.cmp(a.profitLow);
  if (low) return low;
  const high = b.profitHigh.cmp(a.profitHigh);
  if (high) return high;
  if (a.allocations.length !== b.allocations.length)
    return b.allocations.length - a.allocations.length;
  const cash = a.cash.cmp(b.cash);
  if (cash) return cash;
  return a.key.localeCompare(b.key);
}

function solveExact(input: {
  candidates: Prepared[];
  budget: D;
  constraints: PortfolioConstraints;
  nodeLimit: number;
}) {
  const candidates = [...input.candidates].sort((left, right) => {
    const ratio = right.conservativeReturnOnCash.cmp(
      left.conservativeReturnOnCash,
    );
    return ratio || left.input.id.localeCompare(right.input.id);
  });
  const maxBrand = percentageOf(
    input.budget,
    decimal(input.constraints.maxBrandExposurePercent),
  );
  const maxCategory = percentageOf(
    input.budget,
    decimal(input.constraints.maxCategoryExposurePercent),
  );
  const bestRemainingRatio: D[] = [];
  let best = new Decimal(0);
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    best = Decimal.max(best, candidates[index]!.conservativeReturnOnCash);
    bestRemainingRatio[index] = best;
  }
  const top: SearchSolution[] = [];
  let nodes = 0;
  let limitExceeded = false;
  const addSolution = (
    allocations: SearchAllocation[],
    cash: D,
    low: D,
    high: D,
  ) => {
    if (!allocations.length) return;
    const normalized = [...allocations].sort((a, b) =>
      a.candidate.input.id.localeCompare(b.candidate.input.id),
    );
    const key = normalized
      .map(
        (allocation) =>
          `${allocation.candidate.input.id}:${allocation.quantity}`,
      )
      .join("|");
    if (top.some((solution) => solution.key === key)) return;
    top.push({
      allocations: normalized,
      cash,
      profitLow: low,
      profitHigh: high,
      key,
    });
    top.sort(solutionComparator);
    if (top.length > 4) top.length = 4;
  };
  const visit = (
    index: number,
    allocations: SearchAllocation[],
    cash: D,
    low: D,
    high: D,
    brandCash: Map<string, D>,
    categoryCash: Map<string, D>,
  ) => {
    nodes += 1;
    if (nodes > input.nodeLimit) {
      limitExceeded = true;
      return;
    }
    if (index === candidates.length) {
      addSolution(allocations, cash, low, high);
      return;
    }
    if (top.length === 4) {
      const remainingCash = input.budget.minus(cash);
      const upper = low.plus(
        remainingCash.mul(bestRemainingRatio[index] ?? new Decimal(0)),
      );
      if (upper.lt(top[3]!.profitLow)) return;
    }
    const candidate = candidates[index]!;
    for (const quantity of candidate.quantities) {
      if (limitExceeded) return;
      if (quantity === 0) {
        visit(index + 1, allocations, cash, low, high, brandCash, categoryCash);
        continue;
      }
      const allocation = allocationAt(candidate, quantity);
      const nextCash = cash.plus(allocation.cash);
      if (nextCash.gt(input.budget)) continue;
      const brand = candidate.input.brand.toLocaleLowerCase();
      const category = candidate.input.category.toLocaleLowerCase();
      const nextBrand = (brandCash.get(brand) ?? new Decimal(0)).plus(
        allocation.cash,
      );
      const nextCategory = (categoryCash.get(category) ?? new Decimal(0)).plus(
        allocation.cash,
      );
      if (nextBrand.gt(maxBrand) || nextCategory.gt(maxCategory)) continue;
      const nextBrandCash = new Map(brandCash).set(brand, nextBrand);
      const nextCategoryCash = new Map(categoryCash).set(
        category,
        nextCategory,
      );
      visit(
        index + 1,
        [...allocations, allocation],
        nextCash,
        low.plus(allocation.profitLow),
        high.plus(allocation.profitHigh),
        nextBrandCash,
        nextCategoryCash,
      );
    }
  };
  visit(
    0,
    [],
    new Decimal(0),
    new Decimal(0),
    new Decimal(0),
    new Map(),
    new Map(),
  );
  return { solutions: top, nodes, limitExceeded };
}

function concentration(
  allocations: SearchAllocation[],
  cash: D,
  constraints: PortfolioConstraints,
) {
  const brand = new Map<string, D>();
  const category = new Map<string, D>();
  let maxAsin = new Decimal(0);
  let elevated = new Decimal(0);
  let hhi = new Decimal(0);
  for (const allocation of allocations) {
    const share = allocation.cash.div(cash).mul(100);
    maxAsin = Decimal.max(maxAsin, share);
    hhi = hhi.plus(share.div(100).pow(2));
    const brandKey = allocation.candidate.input.brand.toLocaleLowerCase();
    const categoryKey = allocation.candidate.input.category.toLocaleLowerCase();
    brand.set(
      brandKey,
      (brand.get(brandKey) ?? new Decimal(0)).plus(allocation.cash),
    );
    category.set(
      categoryKey,
      (category.get(categoryKey) ?? new Decimal(0)).plus(allocation.cash),
    );
    const source = allocation.candidate.input;
    if (
      source.seasonalityRisk !== "LOW" ||
      source.competitionRisk !== "LOW" ||
      source.complianceRisk !== "LOW"
    )
      elevated = elevated.plus(allocation.cash);
  }
  const maxGroupShare = (values: Iterable<D>) => {
    let maximum = new Decimal(0);
    for (const value of values)
      maximum = Decimal.max(maximum, value.div(cash).mul(100));
    return maximum;
  };
  const maxBrand = maxGroupShare(brand.values());
  const maxCategory = maxGroupShare(category.values());
  const maxAsinBudgetShare = Decimal.max(
    ...allocations.map((allocation) =>
      allocation.cash.div(decimal(constraints.cashBudget)).mul(100),
    ),
  );
  return {
    values: {
      maxAsinCashPercent: percent(maxAsin),
      maxBrandCashPercent: percent(maxBrand),
      maxCategoryCashPercent: percent(maxCategory),
      cashHhi: fixed(hhi, 6),
      elevatedRiskCashPercent: percent(elevated.div(cash).mul(100)),
    },
    budgetAsinShare: maxAsinBudgetShare,
    brandShareOfUsedCash: maxBrand,
    categoryShareOfUsedCash: maxCategory,
    hhi,
  };
}

function presentSolution(input: {
  solution: SearchSolution;
  rank: number;
  budget: D;
  constraints: PortfolioConstraints;
  initialExclusions: PortfolioExclusion[];
  allCandidates: readonly PortfolioCandidateInput[];
}): PortfolioSolution {
  const selected = new Set(
    input.solution.allocations.map(
      (allocation) => allocation.candidate.input.id,
    ),
  );
  const metrics = concentration(
    input.solution.allocations,
    input.solution.cash,
    input.constraints,
  );
  const constraints = input.constraints;
  const audit: PortfolioConstraintAudit[] = [
    {
      constraint: "CASH_BUDGET",
      limit: money(input.budget),
      actual: money(input.solution.cash),
      passed: input.solution.cash.lte(input.budget),
      details: "Total allocation cannot exceed the configured cash budget.",
    },
    {
      constraint: "MAX_ASIN_EXPOSURE_PERCENT_OF_BUDGET",
      limit: percent(decimal(constraints.maxAsinExposurePercent)),
      actual: percent(metrics.budgetAsinShare),
      passed: metrics.budgetAsinShare.lte(
        decimal(constraints.maxAsinExposurePercent),
      ),
      details: "Each ASIN cash allocation is measured against the full budget.",
    },
    {
      constraint: "MAX_BRAND_EXPOSURE_PERCENT_OF_BUDGET",
      limit: percent(decimal(constraints.maxBrandExposurePercent)),
      actual: percent(
        Decimal.max(
          ...input.solution.allocations.map((allocation) => {
            const brandCash = input.solution.allocations
              .filter(
                (item) =>
                  item.candidate.input.brand.toLocaleLowerCase() ===
                  allocation.candidate.input.brand.toLocaleLowerCase(),
              )
              .reduce((total, item) => total.plus(item.cash), new Decimal(0));
            return brandCash.div(input.budget).mul(100);
          }),
        ),
      ),
      passed: true,
      details: "Combined same-brand cash is constrained during integer search.",
    },
    {
      constraint: "MAX_CATEGORY_EXPOSURE_PERCENT_OF_BUDGET",
      limit: percent(decimal(constraints.maxCategoryExposurePercent)),
      actual: percent(
        Decimal.max(
          ...input.solution.allocations.map((allocation) => {
            const categoryCash = input.solution.allocations
              .filter(
                (item) =>
                  item.candidate.input.category.toLocaleLowerCase() ===
                  allocation.candidate.input.category.toLocaleLowerCase(),
              )
              .reduce((total, item) => total.plus(item.cash), new Decimal(0));
            return categoryCash.div(input.budget).mul(100);
          }),
        ),
      ),
      passed: true,
      details:
        "Combined same-category cash is constrained during integer search.",
    },
    {
      constraint: "MOQ_AND_CASE_PACK",
      limit: "Every selected quantity >= MOQ and divisible by case pack",
      actual: input.solution.allocations
        .map(
          (allocation) =>
            `${allocation.candidate.input.asin}:${allocation.quantity}`,
        )
        .join(", "),
      passed: input.solution.allocations.every(
        (allocation) =>
          allocation.quantity >= allocation.candidate.input.moq &&
          allocation.quantity % allocation.candidate.input.casePack === 0,
      ),
      details:
        "Quantities are integer case multiples; minimum lot rounds MOQ up to a full case.",
    },
  ];
  const notSelected: PortfolioExclusion[] = input.allCandidates
    .filter(
      (candidate) =>
        !selected.has(candidate.id) &&
        !input.initialExclusions.some(
          (exclusion) => exclusion.candidateId === candidate.id,
        ),
    )
    .map((candidate) => ({
      candidateId: candidate.id,
      asin: candidate.asin,
      reasons: ["NOT_SELECTED_BY_CONSERVATIVE_PROFIT_OBJECTIVE"],
    }));
  return {
    rank: input.rank,
    allocations: input.solution.allocations.map((allocation) => ({
      candidateId: allocation.candidate.input.id,
      catalogProductId: allocation.candidate.input.catalogProductId,
      asin: allocation.candidate.input.asin,
      brand: allocation.candidate.input.brand,
      category: allocation.candidate.input.category,
      quantity: allocation.quantity,
      casePack: allocation.candidate.input.casePack,
      moq: allocation.candidate.input.moq,
      unitCost: money(allocation.candidate.unitCost),
      cashAllocated: money(allocation.cash),
      expectedProfitLow: money(allocation.profitLow),
      expectedProfitHigh: money(allocation.profitHigh),
      expectedUnitsSoldLow: fixed(allocation.unitsLow),
      expectedUnitsSoldHigh: fixed(allocation.unitsHigh),
      coverageDays: allocation.candidate.coverageDays,
      evidenceReferences: uniqueStrings(
        allocation.candidate.input.evidenceReferences,
      ),
    })),
    cashUsed: money(input.solution.cash),
    cashRemaining: money(input.budget.minus(input.solution.cash)),
    expectedProfitLow: money(input.solution.profitLow),
    expectedProfitHigh: money(input.solution.profitHigh),
    productCount: input.solution.allocations.length,
    diversificationScore: percent(new Decimal(1).minus(metrics.hhi).mul(100)),
    riskConcentration: metrics.values,
    constraintAudit: audit,
    excludedProducts: [...input.initialExclusions, ...notSelected].sort(
      (a, b) => a.candidateId.localeCompare(b.candidateId),
    ),
  };
}

function optimizeScenario(input: {
  scenario: PortfolioScenario;
  candidates: readonly PortfolioCandidateInput[];
  constraints: PortfolioConstraints;
  stress: PortfolioStressAssumptions;
  budget: D;
  nodeLimit: number;
}): PortfolioScenarioOutput {
  try {
    const prepared: Prepared[] = [];
    const exclusions: PortfolioExclusion[] = [];
    for (const candidate of [...input.candidates].sort((a, b) =>
      a.id.localeCompare(b.id),
    )) {
      const result = prepareCandidate(
        candidate,
        input.scenario,
        input.constraints,
        input.budget,
        input.stress,
      );
      if (result.prepared) prepared.push(result.prepared);
      else
        exclusions.push({
          candidateId: candidate.id,
          asin: candidate.asin,
          reasons: result.reasons,
        });
    }
    if (!prepared.length)
      return {
        scenario: input.scenario,
        status: "NO_FEASIBLE_PORTFOLIO",
        assumptions: scenarioAssumptions(input.scenario, input.stress),
        alternatives: [],
        reasonCodes: ["ALL_CANDIDATES_EXCLUDED"],
        searchNodes: 0,
        exactOptimal: true,
      };
    const solved = solveExact({
      candidates: prepared,
      budget: input.budget,
      constraints: input.constraints,
      nodeLimit: input.nodeLimit,
    });
    if (solved.limitExceeded)
      return {
        scenario: input.scenario,
        status: "SOLVER_FAILED",
        assumptions: scenarioAssumptions(input.scenario, input.stress),
        alternatives: [],
        reasonCodes: ["SEARCH_NODE_LIMIT_EXCEEDED"],
        searchNodes: solved.nodes,
        exactOptimal: false,
      };
    if (!solved.solutions.length)
      return {
        scenario: input.scenario,
        status: "NO_FEASIBLE_PORTFOLIO",
        assumptions: scenarioAssumptions(input.scenario, input.stress),
        alternatives: [],
        reasonCodes: ["NO_NONEMPTY_FEASIBLE_SOLUTION"],
        searchNodes: solved.nodes,
        exactOptimal: true,
      };
    const portfolios = solved.solutions.map((solution, rank) =>
      presentSolution({
        solution,
        rank,
        budget: input.budget,
        constraints: input.constraints,
        initialExclusions: exclusions,
        allCandidates: input.candidates,
      }),
    );
    return {
      scenario: input.scenario,
      status: "CALCULATED",
      assumptions: scenarioAssumptions(input.scenario, input.stress),
      recommended: portfolios[0],
      alternatives: portfolios.slice(1),
      reasonCodes: [],
      searchNodes: solved.nodes,
      exactOptimal: true,
    };
  } catch (error) {
    return {
      scenario: input.scenario,
      status: "SOLVER_FAILED",
      assumptions: scenarioAssumptions(input.scenario, input.stress),
      alternatives: [],
      reasonCodes: [
        error instanceof Error ? error.message : "UNKNOWN_SOLVER_FAILURE",
      ],
      searchNodes: 0,
      exactOptimal: false,
    };
  }
}

/**
 * Exact, deterministic integer branch-and-bound. The objective maximizes the
 * conservative expected profit, then the high estimate, product count, and
 * finally lower cash use. A bounded search that cannot prove optimality fails
 * closed and does not expose its partial incumbent as a recommendation.
 */
export function optimizePortfolio(input: {
  candidates: readonly PortfolioCandidateInput[];
  constraints: PortfolioConstraints;
  stressAssumptions?: PortfolioStressAssumptions | undefined;
}): PortfolioOptimizationOutput {
  const stress =
    input.stressAssumptions ?? DEFAULT_PORTFOLIO_STRESS_ASSUMPTIONS;
  try {
    const { budget, nodeLimit } = validate({
      ...input,
      stressAssumptions: stress,
    });
    const candidates = [...input.candidates].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    const scenarios = PORTFOLIO_SCENARIOS.map((scenario) =>
      optimizeScenario({
        scenario,
        candidates,
        constraints: input.constraints,
        stress,
        budget,
        nodeLimit,
      }),
    );
    const base = scenarios[0]!;
    const failed = scenarios.filter(
      (scenario) => scenario.status === "SOLVER_FAILED",
    );
    const status: PortfolioOptimizationOutput["status"] =
      base.status === "INVALID_INPUT"
        ? "INVALID_INPUT"
        : base.status === "SOLVER_FAILED"
          ? "SOLVER_FAILED"
          : base.status === "NO_FEASIBLE_PORTFOLIO"
            ? "NO_FEASIBLE_PORTFOLIO"
            : failed.length
              ? "PARTIAL_SUCCESS"
              : "CALCULATED";
    return {
      status,
      solverVersion: PORTFOLIO_OPTIMIZER_VERSION,
      currency: input.constraints.currency,
      scenarios,
      reasonCodes: failed.map(
        (scenario) => `${scenario.scenario}:${scenario.reasonCodes.join("|")}`,
      ),
    };
  } catch (error) {
    return {
      status: "INVALID_INPUT",
      solverVersion: PORTFOLIO_OPTIMIZER_VERSION,
      currency: input.constraints.currency,
      scenarios: [],
      reasonCodes: [
        error instanceof Error ? error.message : "INVALID_PORTFOLIO_INPUT",
      ],
    };
  }
}
