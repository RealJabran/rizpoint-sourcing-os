import { Decimal } from "decimal.js";
import type { PackGuardStatus } from "@rizpoint/domain";
export * from "./private-label.js";

Decimal.set({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -100,
  toExpPos: 100,
});

export const PROFIT_ENGINE_VERSION = "profit-engine/v3";
export const ROUNDING_MODE = "HALF_UP";
export type DecimalString = string;
export type ScenarioType =
  "CURRENT" | "CONSERVATIVE" | "STRESS" | "MAP" | "USER_ENTERED";
export type Recommendation =
  | "BUY"
  | "WATCH"
  | "REVIEW_MATCH"
  | "REVIEW_APPROVAL"
  | "REVIEW_COST"
  | "AVOID"
  | "INSUFFICIENT_DATA";

type FreshnessState = "FRESH" | "STALE" | "EXPIRED" | "UNKNOWN";

export type CostInputs = Readonly<{
  supplierCostPerSellableUnit: DecimalString;
  allocatedSupplierFreight: DecimalString;
  prepFee: DecimalString;
  labelingFee: DecimalString;
  polybagFee: DecimalString;
  bundleFee: DecimalString;
  bubblewrapFee: DecimalString;
  inboundShipping: DecimalString;
  dutyOrTax: DecimalString;
  storageAllowance: DecimalString;
  returnAllowance: DecimalString;
  otherCosts: DecimalString;
}>;

export type FeeModel = Readonly<{
  fixedFee: DecimalString;
  percentageOfPrice: DecimalString;
  minimumFee?: DecimalString;
}>;

export type FeeQuote = Readonly<{
  totalFee: DecimalString;
  quotedPrice: DecimalString;
  currency: string;
  provider: string;
  observedAt: string;
  freshUntil: string;
  freshnessState: FreshnessState;
  completeness: "COMPLETE" | "PARTIAL" | "UNKNOWN";
  scenarioSource: "CURRENT_FEATURED_OFFER" | "CONSERVATIVE" | "USER_ENTERED";
  fulfillmentChannel: "AMAZON" | "MERCHANT";
  components: readonly Readonly<{
    feeType: string;
    finalFee: DecimalString;
    currency: string;
    parentFeeType?: string;
  }>[];
  /** Present only for an explicit deterministic fixture/config fee model. */
  model?: FeeModel;
}>;

export type PriceEvidence = Readonly<{
  price: DecimalString;
  currency: string;
  provider: string;
  observedAt: string;
  freshUntil: string;
  freshnessState: FreshnessState;
}>;

export type ProfitInput = Readonly<{
  packGuardStatus: PackGuardStatus;
  price: PriceEvidence;
  feeQuote: FeeQuote;
  costs: CostInputs;
  calculatedAt?: Date;
}>;

export type CalculationEvidence = Readonly<{
  price: PriceEvidence;
  feeQuote: FeeQuote;
  costInputNames: readonly (keyof CostInputs)[];
}>;

export type ProfitOutput = Readonly<{
  status:
    | "CALCULATED"
    | "BLOCKED_PACK_UNCERTAIN"
    | "BLOCKED_INVALID_INPUT"
    | "BLOCKED_STALE_EVIDENCE"
    | "BLOCKED_CURRENCY_MISMATCH";
  effectiveCogs?: DecimalString;
  proceeds?: DecimalString;
  amazonFees?: DecimalString;
  netProfit?: DecimalString;
  roiPercent?: DecimalString;
  marginPercent?: DecimalString;
  breakEvenPrice?: DecimalString;
  exactValues?: Readonly<{
    effectiveCogs: DecimalString;
    proceeds: DecimalString;
    amazonFees: DecimalString;
    netProfit: DecimalString;
    breakEvenPrice?: DecimalString;
  }>;
  evidence?: CalculationEvidence;
  reasonCodes: readonly string[];
  engineVersion: typeof PROFIT_ENGINE_VERSION;
  roundingMode: typeof ROUNDING_MODE;
}>;

export type ScenarioInput = Readonly<{
  current: PriceEvidence;
  conservative: PriceEvidence;
  feeQuote: FeeQuote;
  feeQuotes?: Readonly<Partial<Record<ScenarioType, FeeQuote>>>;
  costs: CostInputs;
  packGuardStatus: PackGuardStatus;
  stressDiscountPercent: DecimalString;
  map?: PriceEvidence;
  userEntered?: PriceEvidence;
  calculatedAt?: Date;
}>;

export type DecisionInput = Readonly<{
  currentProfit: ProfitOutput;
  conservativeProfit: ProfitOutput;
  stressProfit: ProfitOutput;
  mapProfit?: ProfitOutput;
  matchVerified: boolean;
  sellerEligibility:
    | "ELIGIBLE"
    | "RESTRICTED"
    | "APPROVAL_REQUIRED"
    | "INCOMPLETE"
    | "UNAUTHORIZED"
    | "THROTTLED"
    | "UNKNOWN";
  brandPolicy:
    | "PROHIBITED"
    | "APPROVAL_REQUIRED"
    | "APPROVED"
    | "UNRESTRICTED"
    | "UNKNOWN";
  demandEvidenceSufficient: boolean;
  thresholds?: Readonly<{
    minNetProfit: DecimalString;
    minRoiPercent: DecimalString;
    minMarginPercent: DecimalString;
    maxStressLoss: DecimalString;
  }>;
}>;

export type DecisionOutput = Readonly<{
  recommendation: Recommendation;
  reasonCodes: readonly string[];
  failedRules: readonly string[];
}>;

const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;
const COST_NAMES = [
  "supplierCostPerSellableUnit",
  "allocatedSupplierFreight",
  "prepFee",
  "labelingFee",
  "polybagFee",
  "bundleFee",
  "bubblewrapFee",
  "inboundShipping",
  "dutyOrTax",
  "storageAllowance",
  "returnAllowance",
  "otherCosts",
] as const satisfies readonly (keyof CostInputs)[];

function decimal(value: DecimalString): InstanceType<typeof Decimal> {
  if (!DECIMAL_PATTERN.test(value)) throw new Error("INVALID_DECIMAL_INPUT");
  return new Decimal(value);
}

function money(value: InstanceType<typeof Decimal>): DecimalString {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

function roundUpMoney(value: InstanceType<typeof Decimal>): DecimalString {
  return value.toDecimalPlaces(2, Decimal.ROUND_CEIL).toFixed(2);
}

function ratio(value: InstanceType<typeof Decimal>): DecimalString {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

function blocked(
  status: ProfitOutput["status"],
  reasonCode: string,
): ProfitOutput {
  return {
    status,
    reasonCodes: [reasonCode],
    engineVersion: PROFIT_ENGINE_VERSION,
    roundingMode: ROUNDING_MODE,
  };
}

function isFresh(
  value: {
    freshnessState: FreshnessState;
    observedAt: string;
    freshUntil: string;
  },
  now: Date,
): boolean {
  const observedAt = new Date(value.observedAt);
  const freshUntil = new Date(value.freshUntil);
  return (
    value.freshnessState === "FRESH" &&
    !Number.isNaN(observedAt.getTime()) &&
    !Number.isNaN(freshUntil.getTime()) &&
    freshUntil.getTime() >= now.getTime()
  );
}

function modeledFeeAtPrice(
  price: InstanceType<typeof Decimal>,
  model: FeeModel,
): InstanceType<typeof Decimal> {
  const fixedFee = decimal(model.fixedFee);
  const percentage = decimal(model.percentageOfPrice);
  const minimumFee = decimal(model.minimumFee ?? "0");
  if (
    fixedFee.lt(0) ||
    percentage.lt(0) ||
    minimumFee.lt(0) ||
    percentage.gt(1)
  ) {
    throw new Error("INVALID_FEE_MODEL");
  }
  return Decimal.max(minimumFee, fixedFee.plus(price.mul(percentage)));
}

function solveBreakEvenPrice(
  cogs: InstanceType<typeof Decimal>,
  model: FeeModel,
): InstanceType<typeof Decimal> {
  let lower = new Decimal(0);
  let upper = Decimal.max(
    new Decimal(1),
    cogs.plus(modeledFeeAtPrice(cogs, model)).mul(2),
  );
  const netAt = (price: InstanceType<typeof Decimal>) =>
    price.minus(cogs).minus(modeledFeeAtPrice(price, model));
  while (netAt(upper).lt(0)) {
    upper = upper.mul(2);
    if (upper.gt("1000000")) throw new Error("BREAK_EVEN_UNBOUNDED");
  }
  for (let iteration = 0; iteration < 120; iteration += 1) {
    const middle = lower.plus(upper).div(2);
    if (netAt(middle).gte(0)) upper = middle;
    else lower = middle;
  }
  return upper;
}

function assertEvidence(input: ProfitInput, now: Date): void {
  if (!isFresh(input.price, now) || !isFresh(input.feeQuote, now)) {
    throw new Error("STALE_EVIDENCE");
  }
  if (input.price.currency !== input.feeQuote.currency) {
    throw new Error("CURRENCY_MISMATCH");
  }
  if (!input.price.provider || !input.feeQuote.provider) {
    throw new Error("MISSING_PROVENANCE");
  }
  const quotedPrice = decimal(input.feeQuote.quotedPrice);
  const quotedFee = decimal(input.feeQuote.totalFee);
  if (input.feeQuote.completeness !== "COMPLETE")
    throw new Error("INCOMPLETE_FEE_QUOTE");
  if (!quotedPrice.gt(0) || quotedFee.lt(0))
    throw new Error("INVALID_FEE_QUOTE");
  if (input.feeQuote.components.length === 0)
    throw new Error("MISSING_FEE_COMPONENTS");
  const topLevelTotal = input.feeQuote.components
    .filter((component) => !component.parentFeeType)
    .reduce((total, component) => {
      if (component.currency !== input.feeQuote.currency)
        throw new Error("CURRENCY_MISMATCH");
      return total.plus(decimal(component.finalFee));
    }, new Decimal(0));
  if (!topLevelTotal.eq(quotedFee))
    throw new Error("FEE_COMPONENT_TOTAL_MISMATCH");
  if (
    input.feeQuote.model &&
    !modeledFeeAtPrice(quotedPrice, input.feeQuote.model).eq(quotedFee)
  ) {
    throw new Error("FEE_QUOTE_MODEL_MISMATCH");
  }
}

function feeAtPrice(
  price: InstanceType<typeof Decimal>,
  quote: FeeQuote,
): InstanceType<typeof Decimal> {
  if (quote.model) return modeledFeeAtPrice(price, quote.model);
  if (!price.eq(decimal(quote.quotedPrice)))
    throw new Error("FEE_QUOTE_PRICE_MISMATCH");
  return decimal(quote.totalFee);
}

/** Throws at the boundary so blocked pack relationships cannot enter a financial formula. */
export function assertCalculationAllowed(input: {
  readonly packGuardStatus: PackGuardStatus;
}): void {
  if (input.packGuardStatus !== "VERIFIED") {
    throw new Error(
      "Profit calculation is blocked until the pack relationship is verified.",
    );
  }
}

export function calculateProfit(input: ProfitInput): ProfitOutput {
  if (input.packGuardStatus !== "VERIFIED") {
    return blocked("BLOCKED_PACK_UNCERTAIN", input.packGuardStatus);
  }
  try {
    const now = input.calculatedAt ?? new Date();
    assertEvidence(input, now);
    const price = decimal(input.price.price);
    const supplierCost = decimal(input.costs.supplierCostPerSellableUnit);
    const costValues = COST_NAMES.map((name) => decimal(input.costs[name]));
    if (
      price.lte(0) ||
      supplierCost.lte(0) ||
      costValues.some((value) => value.lt(0))
    ) {
      throw new Error("INVALID_COST_OR_PRICE");
    }
    const effectiveCogs = costValues.reduce(
      (total, value) => total.plus(value),
      new Decimal(0),
    );
    const amazonFees = feeAtPrice(price, input.feeQuote);
    const netProfit = price.minus(effectiveCogs).minus(amazonFees);
    const breakEven = input.feeQuote.model
      ? solveBreakEvenPrice(effectiveCogs, input.feeQuote.model)
      : null;
    return {
      status: "CALCULATED",
      effectiveCogs: money(effectiveCogs),
      proceeds: money(price),
      amazonFees: money(amazonFees),
      netProfit: money(netProfit),
      roiPercent: ratio(netProfit.div(effectiveCogs).mul(100)),
      marginPercent: ratio(netProfit.div(price).mul(100)),
      ...(breakEven ? { breakEvenPrice: roundUpMoney(breakEven) } : {}),
      exactValues: {
        effectiveCogs: effectiveCogs.toFixed(4),
        proceeds: price.toFixed(4),
        amazonFees: amazonFees.toFixed(4),
        netProfit: netProfit.toFixed(4),
        ...(breakEven ? { breakEvenPrice: breakEven.toFixed(4) } : {}),
      },
      evidence: {
        price: input.price,
        feeQuote: input.feeQuote,
        costInputNames: COST_NAMES,
      },
      reasonCodes: [],
      engineVersion: PROFIT_ENGINE_VERSION,
      roundingMode: ROUNDING_MODE,
    };
  } catch (error) {
    if (error instanceof Error && error.message === "STALE_EVIDENCE") {
      return blocked("BLOCKED_STALE_EVIDENCE", "STALE_OR_EXPIRED_EVIDENCE");
    }
    if (error instanceof Error && error.message === "CURRENCY_MISMATCH") {
      return blocked("BLOCKED_CURRENCY_MISMATCH", "CURRENCY_MISMATCH");
    }
    return blocked("BLOCKED_INVALID_INPUT", "INVALID_FINANCIAL_INPUT");
  }
}

export function deriveStressPrice(
  conservativePrice: DecimalString,
  stressDiscountPercent: DecimalString,
): DecimalString {
  const price = decimal(conservativePrice);
  const discount = decimal(stressDiscountPercent);
  if (!price.gt(0) || discount.lt(0) || discount.gte(100))
    throw new Error("INVALID_STRESS_SCENARIO");
  return price.mul(new Decimal(1).minus(discount.div(100))).toFixed(4);
}

export function buildScenarios(
  input: ScenarioInput,
): Readonly<Partial<Record<ScenarioType, ProfitOutput>>> {
  try {
    const stressDiscount = decimal(input.stressDiscountPercent);
    if (stressDiscount.lt(0) || stressDiscount.gte(100)) {
      return {
        CURRENT: blocked("BLOCKED_INVALID_INPUT", "INVALID_STRESS_DISCOUNT"),
        CONSERVATIVE: blocked(
          "BLOCKED_INVALID_INPUT",
          "INVALID_STRESS_DISCOUNT",
        ),
        STRESS: blocked("BLOCKED_INVALID_INPUT", "INVALID_STRESS_DISCOUNT"),
      };
    }
    const stressPrice = deriveStressPrice(
      input.conservative.price,
      input.stressDiscountPercent,
    );
    const common = {
      packGuardStatus: input.packGuardStatus,
      costs: input.costs,
      ...(input.calculatedAt ? { calculatedAt: input.calculatedAt } : {}),
    };
    const stressEvidence: PriceEvidence = {
      ...input.conservative,
      price: stressPrice,
    };
    return {
      CURRENT: calculateProfit({
        ...common,
        price: input.current,
        feeQuote: input.feeQuotes?.CURRENT ?? input.feeQuote,
      }),
      CONSERVATIVE: calculateProfit({
        ...common,
        price: input.conservative,
        feeQuote: input.feeQuotes?.CONSERVATIVE ?? input.feeQuote,
      }),
      STRESS: calculateProfit({
        ...common,
        price: stressEvidence,
        feeQuote: input.feeQuotes?.STRESS ?? input.feeQuote,
      }),
      ...(input.map
        ? {
            MAP: calculateProfit({
              ...common,
              price: input.map,
              feeQuote: input.feeQuotes?.MAP ?? input.feeQuote,
            }),
          }
        : {}),
      ...(input.userEntered
        ? {
            USER_ENTERED: calculateProfit({
              ...common,
              price: input.userEntered,
              feeQuote: input.feeQuotes?.USER_ENTERED ?? input.feeQuote,
            }),
          }
        : {}),
    };
  } catch {
    return {
      CURRENT: blocked("BLOCKED_INVALID_INPUT", "INVALID_SCENARIO_INPUT"),
      CONSERVATIVE: blocked("BLOCKED_INVALID_INPUT", "INVALID_SCENARIO_INPUT"),
      STRESS: blocked("BLOCKED_INVALID_INPUT", "INVALID_SCENARIO_INPUT"),
    };
  }
}

function validThresholds(
  input: NonNullable<DecisionInput["thresholds"]>,
): boolean {
  try {
    return (
      decimal(input.minNetProfit).gte(0) &&
      decimal(input.minRoiPercent).gte(0) &&
      decimal(input.minMarginPercent).gte(0) &&
      decimal(input.maxStressLoss).lte(0)
    );
  } catch {
    return false;
  }
}

export function decide(input: DecisionInput): DecisionOutput {
  const thresholds = input.thresholds ?? {
    minNetProfit: "3.00",
    minRoiPercent: "30.00",
    minMarginPercent: "10.00",
    maxStressLoss: "0.00",
  };
  if (!validThresholds(thresholds)) {
    return {
      recommendation: "INSUFFICIENT_DATA",
      reasonCodes: ["INVALID_DECISION_POLICY"],
      failedRules: ["THRESHOLDS_VALID"],
    };
  }
  if (
    input.sellerEligibility === "RESTRICTED" ||
    input.brandPolicy === "PROHIBITED"
  ) {
    return {
      recommendation: "AVOID",
      reasonCodes: ["RESTRICTED_OR_PROHIBITED"],
      failedRules: ["ELIGIBILITY_ALLOWED"],
    };
  }
  if (
    !input.matchVerified ||
    input.currentProfit.status === "BLOCKED_PACK_UNCERTAIN"
  ) {
    return {
      recommendation: "REVIEW_MATCH",
      reasonCodes: ["PACK_OR_MATCH_UNVERIFIED"],
      failedRules: ["MATCH_AND_PACK_VERIFIED"],
    };
  }
  if (
    input.sellerEligibility === "APPROVAL_REQUIRED" ||
    ["APPROVAL_REQUIRED", "UNKNOWN"].includes(input.brandPolicy)
  ) {
    return {
      recommendation: "REVIEW_APPROVAL",
      reasonCodes: ["APPROVAL_EVIDENCE_REQUIRED"],
      failedRules: ["APPROVAL_RESOLVED"],
    };
  }
  if (input.sellerEligibility !== "ELIGIBLE") {
    return {
      recommendation: "INSUFFICIENT_DATA",
      reasonCodes: ["SELLER_ELIGIBILITY_UNRESOLVED"],
      failedRules: ["ELIGIBILITY_COMPLETE"],
    };
  }
  if (
    !input.demandEvidenceSufficient ||
    input.currentProfit.status !== "CALCULATED" ||
    input.conservativeProfit.status !== "CALCULATED" ||
    input.stressProfit.status !== "CALCULATED"
  ) {
    return {
      recommendation: "INSUFFICIENT_DATA",
      reasonCodes: ["MISSING_OR_STALE_EVIDENCE"],
      failedRules: ["FINANCIAL_AND_DEMAND_EVIDENCE_FRESH"],
    };
  }
  const conservative = input.conservativeProfit;
  const failedRules = [
    ...(decimal(conservative.netProfit!).lt(decimal(thresholds.minNetProfit))
      ? ["MIN_NET_PROFIT"]
      : []),
    ...(decimal(conservative.roiPercent!).lt(decimal(thresholds.minRoiPercent))
      ? ["MIN_ROI"]
      : []),
    ...(decimal(conservative.marginPercent!).lt(
      decimal(thresholds.minMarginPercent),
    )
      ? ["MIN_MARGIN"]
      : []),
  ];
  if (failedRules.length > 0) {
    return {
      recommendation: "WATCH",
      reasonCodes: ["CONSERVATIVE_THRESHOLDS_NOT_MET"],
      failedRules,
    };
  }
  if (
    decimal(input.stressProfit.netProfit!).lt(decimal(thresholds.maxStressLoss))
  ) {
    return {
      recommendation: "REVIEW_COST",
      reasonCodes: ["STRESS_SCENARIO_LOSS"],
      failedRules: ["STRESS_LOSS_LIMIT"],
    };
  }
  return {
    recommendation: "BUY",
    reasonCodes: ["CONSERVATIVE_RULES_MET"],
    failedRules: [],
  };
}
