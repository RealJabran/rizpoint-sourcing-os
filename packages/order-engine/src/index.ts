import { Decimal } from "decimal.js";

Decimal.set({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -100,
  toExpPos: 100,
});
export const ORDER_ENGINE_VERSION = "order-engine/v1";
export type DecimalString = string;

export type ScenarioSnapshot = Readonly<{
  price: DecimalString;
  effectiveCogs: DecimalString;
  amazonFees: DecimalString;
  netProfit: DecimalString;
  supplierUnitCost: DecimalString;
  currency: string;
}>;
export type OrderLineInput = Readonly<{
  requestedUnits: number;
  casePack: number;
  minimumOrderCases: number;
  orderMultipleCases: number;
  scenario: ScenarioSnapshot;
}>;
export type OrderLine = Readonly<{
  requestedUnits: number;
  casePack: number;
  minimumOrderCases: number;
  orderMultipleCases: number;
  scenario: ScenarioSnapshot;
  orderedCases: number;
  orderedSellableUnits: number;
  supplierTotal: DecimalString;
  landedCostTotal: DecimalString;
  projectedRevenueTotal: DecimalString;
  amazonFeeTotal: DecimalString;
  projectedProfitTotal: DecimalString;
  warnings: readonly string[];
}>;

function decimal(value: string): Decimal {
  if (!/^-?\d+(\.\d+)?$/.test(value)) throw new Error("INVALID_DECIMAL");
  return new Decimal(value);
}
function money(value: Decimal): string {
  return value.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
}
function integer(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`INVALID_${name}`);
}
export function roundOrderQuantity(
  input: Pick<
    OrderLineInput,
    "requestedUnits" | "casePack" | "minimumOrderCases" | "orderMultipleCases"
  >,
) {
  integer(input.requestedUnits, "REQUESTED_UNITS");
  integer(input.casePack, "CASE_PACK");
  integer(input.minimumOrderCases, "MOQ_CASES");
  integer(input.orderMultipleCases, "ORDER_MULTIPLE");
  const requestedCases = Math.ceil(input.requestedUnits / input.casePack);
  const beforeMultiple = Math.max(requestedCases, input.minimumOrderCases);
  const orderedCases =
    Math.ceil(beforeMultiple / input.orderMultipleCases) *
    input.orderMultipleCases;
  if (
    !Number.isSafeInteger(orderedCases) ||
    !Number.isSafeInteger(orderedCases * input.casePack)
  )
    throw new Error("QUANTITY_OVERFLOW");
  return {
    orderedCases,
    orderedSellableUnits: orderedCases * input.casePack,
    requestedCases,
  };
}
export function buildOrderLine(input: OrderLineInput): OrderLine {
  const quantity = roundOrderQuantity(input);
  const scenario = input.scenario;
  const amounts = [
    scenario.price,
    scenario.effectiveCogs,
    scenario.amazonFees,
    scenario.netProfit,
    scenario.supplierUnitCost,
  ].map(decimal);
  if (amounts.slice(0, 4).some((value) => value.lt(0)) || amounts[4]!.lte(0))
    throw new Error("INVALID_SCENARIO_AMOUNT");
  if (!/^[A-Z]{3}$/.test(scenario.currency))
    throw new Error("INVALID_CURRENCY");
  const units = new Decimal(quantity.orderedSellableUnits);
  return {
    ...input,
    ...quantity,
    supplierTotal: money(amounts[4]!.mul(units)),
    landedCostTotal: money(amounts[1]!.mul(units)),
    projectedRevenueTotal: money(amounts[0]!.mul(units)),
    amazonFeeTotal: money(amounts[2]!.mul(units)),
    projectedProfitTotal: money(amounts[3]!.mul(units)),
    warnings:
      quantity.orderedSellableUnits > input.requestedUnits
        ? ["CARTON_ROUNDING_APPLIED"]
        : [],
  };
}
export function sumOrderLines(
  lines: readonly Pick<
    OrderLine,
    | "supplierTotal"
    | "landedCostTotal"
    | "projectedRevenueTotal"
    | "amazonFeeTotal"
    | "projectedProfitTotal"
  >[],
) {
  const sum = (field: keyof (typeof lines)[number]) =>
    money(
      lines.reduce(
        (total, line) => total.plus(decimal(line[field] as string)),
        new Decimal(0),
      ),
    );
  return {
    supplierSubtotal: sum("supplierTotal"),
    landedCostTotal: sum("landedCostTotal"),
    projectedRevenueTotal: sum("projectedRevenueTotal"),
    amazonFeeTotal: sum("amazonFeeTotal"),
    projectedProfitTotal: sum("projectedProfitTotal"),
  };
}
