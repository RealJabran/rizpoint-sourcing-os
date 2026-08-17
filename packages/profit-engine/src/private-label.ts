import { Decimal as DecimalJs } from "decimal.js";

const Decimal = DecimalJs.clone({
  precision: 40,
  rounding: DecimalJs.ROUND_HALF_UP,
  toExpNeg: -100,
  toExpPos: 100,
});

export const PRIVATE_LABEL_ENGINE_VERSION = "private-label-profit/v1";
export const PRIVATE_LABEL_COST_CATEGORIES = [
  "SAMPLES",
  "TOOLING_SETUP",
  "PACKAGING",
  "LABELING",
  "INSPECTION",
  "FREIGHT",
  "CUSTOMS_TARIFFS",
  "INSURANCE",
  "PREP",
  "INBOUND_SHIPPING",
  "AMAZON_REFERRAL",
  "AMAZON_FBA",
  "STORAGE_ALLOWANCE",
  "RETURNS_ALLOWANCE",
  "AD_LAUNCH_BUDGET",
  "COUPON_PROMO",
  "DEFECT_ALLOWANCE",
] as const;
export type PrivateLabelCostCategory =
  (typeof PRIVATE_LABEL_COST_CATEGORIES)[number];
export type PrivateLabelAllocation =
  "PER_UNIT" | "BATCH_TOTAL" | "PERCENT_OF_PRICE";
export type PrivateLabelDecimal = string;

export type PrivateLabelCostInput = Readonly<{
  category: PrivateLabelCostCategory;
  allocation: PrivateLabelAllocation;
  amount?: PrivateLabelDecimal;
  currency: string;
  source: string;
  assumedAt: string;
  confidence: "CONFIRMED" | "ESTIMATED" | "UNKNOWN";
}>;

export type PrivateLabelScenarioInput = Readonly<{
  incoterm: "EXW" | "FOB" | "DDP";
  supplierCurrency: string;
  analysisCurrency: string;
  unitCost: PrivateLabelDecimal;
  moq: number;
  targetSellingPrice: PrivateLabelDecimal;
  unitCostSource: string;
  unitCostAssumedAt: string;
  costs: readonly PrivateLabelCostInput[];
  fxObservation?: Readonly<{
    fromCurrency: string;
    toCurrency: string;
    rate: PrivateLabelDecimal;
    source: string;
    observedAt: string;
  }>;
}>;

export type PrivateLabelScenarioOutput = Readonly<{
  status: "CALCULATED" | "BLOCKED_MISSING_COST" | "BLOCKED_INVALID_INPUT";
  formulaVersion: typeof PRIVATE_LABEL_ENGINE_VERSION;
  currency: string;
  landedCostPerUnit?: PrivateLabelDecimal;
  contributionMarginPerUnit?: PrivateLabelDecimal;
  netProfitPerUnit?: PrivateLabelDecimal;
  roiPercent?: PrivateLabelDecimal;
  marginPercent?: PrivateLabelDecimal;
  breakEvenSalePrice?: PrivateLabelDecimal;
  breakEvenAdSpendPerUnit?: PrivateLabelDecimal;
  breakEvenAcosPercent?: PrivateLabelDecimal;
  initialCashRequired?: PrivateLabelDecimal;
  moqCashExposure?: PrivateLabelDecimal;
  waterfall?: readonly Readonly<{
    category: "UNIT_COST" | PrivateLabelCostCategory;
    perUnit: PrivateLabelDecimal;
    confidence: "CONFIRMED" | "ESTIMATED";
  }>[];
  uncertainCosts: readonly PrivateLabelCostCategory[];
  reasonCodes: readonly string[];
}>;

const decimalPattern = /^-?\d+(?:\.\d+)?$/;
const oneTime = new Set<PrivateLabelCostCategory>(["SAMPLES", "TOOLING_SETUP"]);
const landed = new Set<PrivateLabelCostCategory>([
  "PACKAGING",
  "LABELING",
  "INSPECTION",
  "FREIGHT",
  "CUSTOMS_TARIFFS",
  "INSURANCE",
  "PREP",
  "INBOUND_SHIPPING",
]);
const upfront = new Set<PrivateLabelCostCategory>([
  ...oneTime,
  ...landed,
  "AD_LAUNCH_BUDGET",
]);

function decimal(value: string) {
  if (!decimalPattern.test(value)) throw new Error("INVALID_DECIMAL_INPUT");
  return new Decimal(value);
}
function fixed(value: InstanceType<typeof Decimal>, places = 4) {
  return value.toDecimalPlaces(places, Decimal.ROUND_HALF_UP).toFixed(places);
}
function money(value: InstanceType<typeof Decimal>) {
  return fixed(value, 4);
}
function validDate(value: string) {
  return !Number.isNaN(new Date(value).getTime());
}

function blocked(
  status: "BLOCKED_MISSING_COST" | "BLOCKED_INVALID_INPUT",
  currency: string,
  reasonCodes: string[],
  uncertainCosts: PrivateLabelCostCategory[] = [],
): PrivateLabelScenarioOutput {
  return {
    status,
    formulaVersion: PRIVATE_LABEL_ENGINE_VERSION,
    currency,
    uncertainCosts,
    reasonCodes,
  };
}

export function calculatePrivateLabelScenario(
  input: PrivateLabelScenarioInput,
): PrivateLabelScenarioOutput {
  try {
    if (
      !Number.isSafeInteger(input.moq) ||
      input.moq <= 0 ||
      !/^[A-Z]{3}$/.test(input.supplierCurrency) ||
      !/^[A-Z]{3}$/.test(input.analysisCurrency) ||
      !input.unitCostSource.trim() ||
      !validDate(input.unitCostAssumedAt)
    )
      return blocked("BLOCKED_INVALID_INPUT", input.analysisCurrency, [
        "INVALID_SCENARIO_HEADER",
      ]);
    const unitCost = decimal(input.unitCost);
    const price = decimal(input.targetSellingPrice);
    if (!unitCost.gt(0) || !price.gt(0))
      return blocked("BLOCKED_INVALID_INPUT", input.analysisCurrency, [
        "NON_POSITIVE_UNIT_COST_OR_PRICE",
      ]);
    const byCategory = new Map(
      input.costs.map((cost) => [cost.category, cost]),
    );
    if (byCategory.size !== input.costs.length)
      return blocked("BLOCKED_INVALID_INPUT", input.analysisCurrency, [
        "DUPLICATE_COST_CATEGORY",
      ]);
    for (const cost of input.costs)
      if (
        !cost.source.trim() ||
        !validDate(cost.assumedAt) ||
        !/^[A-Z]{3}$/.test(cost.currency)
      )
        return blocked("BLOCKED_INVALID_INPUT", input.analysisCurrency, [
          "COST_PROVENANCE_REQUIRED",
        ]);
    const missing = PRIVATE_LABEL_COST_CATEGORIES.filter(
      (category) => !byCategory.has(category),
    );
    const unknown = input.costs
      .filter(
        (cost) => cost.confidence === "UNKNOWN" || cost.amount === undefined,
      )
      .map((cost) => cost.category);
    if (missing.length || unknown.length)
      return blocked(
        "BLOCKED_MISSING_COST",
        input.analysisCurrency,
        [
          ...missing.map((category) => `MISSING_${category}`),
          ...unknown.map((category) => `UNKNOWN_${category}`),
        ],
        [...new Set([...missing, ...unknown])],
      );
    const needsFx = input.supplierCurrency !== input.analysisCurrency;
    if (
      needsFx &&
      (!input.fxObservation ||
        input.fxObservation.fromCurrency !== input.supplierCurrency ||
        input.fxObservation.toCurrency !== input.analysisCurrency ||
        !input.fxObservation.source.trim() ||
        !validDate(input.fxObservation.observedAt) ||
        !decimal(input.fxObservation.rate).gt(0))
    )
      return blocked("BLOCKED_INVALID_INPUT", input.analysisCurrency, [
        "FX_OBSERVATION_REQUIRED",
      ]);
    const fx = needsFx ? decimal(input.fxObservation!.rate) : new Decimal(1);
    const convert = (
      amount: InstanceType<typeof Decimal>,
      currency: string,
    ) => {
      if (currency === input.analysisCurrency) return amount;
      if (currency === input.supplierCurrency) return amount.mul(fx);
      throw new Error("UNSUPPORTED_COST_CURRENCY");
    };
    const unitCostAnalysis = convert(unitCost, input.supplierCurrency);
    let landedCost = unitCostAnalysis;
    let operatingCost = new Decimal(0);
    let oneTimePerUnit = new Decimal(0);
    let priceRate = new Decimal(0);
    let initialCash = unitCostAnalysis.mul(input.moq);
    let moqExposure = unitCostAnalysis.mul(input.moq);
    let adCostPerUnit = new Decimal(0);
    const waterfall: Array<{
      category: "UNIT_COST" | PrivateLabelCostCategory;
      perUnit: string;
      confidence: "CONFIRMED" | "ESTIMATED";
    }> = [
      {
        category: "UNIT_COST",
        perUnit: money(unitCostAnalysis),
        confidence: "CONFIRMED",
      },
    ];
    const uncertainCosts: PrivateLabelCostCategory[] = [];
    for (const category of PRIVATE_LABEL_COST_CATEGORIES) {
      const cost = byCategory.get(category)!;
      const raw = decimal(cost.amount!);
      if (raw.lt(0)) throw new Error("NEGATIVE_COST");
      if (
        cost.allocation === "PERCENT_OF_PRICE" &&
        !landed.has(category) &&
        !oneTime.has(category)
      ) {
        if (raw.gt(100)) throw new Error("INVALID_PERCENT_COST");
        priceRate = priceRate.plus(raw.div(100));
      } else if (cost.allocation === "PERCENT_OF_PRICE") {
        throw new Error("PERCENT_NOT_ALLOWED_FOR_ACQUISITION_COST");
      }
      const perUnit =
        cost.allocation === "PERCENT_OF_PRICE"
          ? price.mul(raw).div(100)
          : cost.allocation === "BATCH_TOTAL"
            ? convert(raw, cost.currency).div(input.moq)
            : convert(raw, cost.currency);
      if (oneTime.has(category)) oneTimePerUnit = oneTimePerUnit.plus(perUnit);
      else if (landed.has(category)) landedCost = landedCost.plus(perUnit);
      else operatingCost = operatingCost.plus(perUnit);
      if (category === "AD_LAUNCH_BUDGET") adCostPerUnit = perUnit;
      if (upfront.has(category) && cost.allocation !== "PERCENT_OF_PRICE") {
        const total =
          cost.allocation === "BATCH_TOTAL"
            ? convert(raw, cost.currency)
            : convert(raw, cost.currency).mul(input.moq);
        initialCash = initialCash.plus(total);
        if (landed.has(category)) moqExposure = moqExposure.plus(total);
      }
      if (cost.confidence === "ESTIMATED") uncertainCosts.push(category);
      waterfall.push({
        category,
        perUnit: money(perUnit),
        confidence: cost.confidence === "CONFIRMED" ? "CONFIRMED" : "ESTIMATED",
      });
    }
    const contribution = price.minus(landedCost).minus(operatingCost);
    const netProfit = contribution.minus(oneTimePerUnit);
    const investedPerUnit = landedCost.plus(oneTimePerUnit);
    const fixedCostAtAnyPrice = investedPerUnit.plus(
      operatingCost.minus(price.mul(priceRate)),
    );
    const breakEvenPrice = priceRate.lt(1)
      ? fixedCostAtAnyPrice.div(new Decimal(1).minus(priceRate))
      : null;
    const breakEvenAd = adCostPerUnit.plus(netProfit);
    const reasonCodes = uncertainCosts.map(
      (category) => `ESTIMATED_${category}`,
    );
    if (!breakEvenPrice)
      reasonCodes.push("BREAK_EVEN_PRICE_UNDEFINED_AT_100_PERCENT_COST_RATE");
    if (breakEvenAd.lt(0))
      reasonCodes.push("NO_NONNEGATIVE_BREAK_EVEN_AD_SPEND");
    return {
      status: "CALCULATED",
      formulaVersion: PRIVATE_LABEL_ENGINE_VERSION,
      currency: input.analysisCurrency,
      landedCostPerUnit: money(landedCost),
      contributionMarginPerUnit: money(contribution),
      netProfitPerUnit: money(netProfit),
      roiPercent: fixed(netProfit.div(investedPerUnit).mul(100)),
      marginPercent: fixed(netProfit.div(price).mul(100)),
      ...(breakEvenPrice ? { breakEvenSalePrice: money(breakEvenPrice) } : {}),
      ...(breakEvenAd.gte(0)
        ? {
            breakEvenAdSpendPerUnit: money(breakEvenAd),
            breakEvenAcosPercent: fixed(breakEvenAd.div(price).mul(100)),
          }
        : {}),
      initialCashRequired: money(initialCash),
      moqCashExposure: money(moqExposure),
      waterfall,
      uncertainCosts,
      reasonCodes,
    };
  } catch (error) {
    return blocked("BLOCKED_INVALID_INPUT", input.analysisCurrency, [
      error instanceof Error ? error.message : "INVALID_SCENARIO_INPUT",
    ]);
  }
}

export function stressPrivateLabelScenario(
  input: PrivateLabelScenarioInput,
  stress: Readonly<{
    name: string;
    priceChangePercent: PrivateLabelDecimal;
    costChangePercent: PrivateLabelDecimal;
  }>,
) {
  const priceMultiplier = new Decimal(1).plus(
    decimal(stress.priceChangePercent).div(100),
  );
  const costMultiplier = new Decimal(1).plus(
    decimal(stress.costChangePercent).div(100),
  );
  if (priceMultiplier.lte(0) || costMultiplier.lt(0))
    throw new Error("INVALID_STRESS_MULTIPLIER");
  const stressed: PrivateLabelScenarioInput = {
    ...input,
    targetSellingPrice: fixed(
      decimal(input.targetSellingPrice).mul(priceMultiplier),
    ),
    unitCost: fixed(decimal(input.unitCost).mul(costMultiplier)),
    costs: input.costs.map((cost) => ({
      ...cost,
      ...(cost.amount !== undefined && cost.allocation !== "PERCENT_OF_PRICE"
        ? { amount: fixed(decimal(cost.amount).mul(costMultiplier)) }
        : {}),
    })),
  };
  return { name: stress.name, result: calculatePrivateLabelScenario(stressed) };
}
