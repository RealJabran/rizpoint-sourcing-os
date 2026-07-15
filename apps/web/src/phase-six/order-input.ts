import {
  buildOrderLine,
  sumOrderLines,
  type ScenarioSnapshot,
} from "@rizpoint/order-engine";
import { Decimal } from "decimal.js";

type Result = {
  isCurrent: boolean;
  status: string;
  recommendation: string | null;
  engineVersion: string;
  evidence: unknown;
  supplierRow: {
    scanJob: { supplierId: string | null };
    normalizedOffer: {
      unitCost: { toString(): string } | null;
      currency: string | null;
      caseCount: number | null;
    } | null;
    matchDecision: {
      status: string;
      reasonCodes: unknown;
      selectedCandidate: { packGuard: { status: string } | null } | null;
    } | null;
  };
  shippingRoute: { id: string; currency: string };
};
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}
function string(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
function exactDecimal(value: string): Decimal {
  if (!/^-?\d+(\.\d+)?$/.test(value))
    throw new Error("INVALID_SCENARIO_DECIMAL");
  return new Decimal(value);
}
function safeMatchDecision(
  value: Result["supplierRow"]["matchDecision"],
): boolean {
  if (!value || !["AUTO_ACCEPTED", "USER_ACCEPTED"].includes(value.status))
    return false;
  return !(
    Array.isArray(value.reasonCodes) &&
    value.reasonCodes.includes("HARD_CONTRADICTION_MANUAL_OVERRIDE")
  );
}
export function scenarioFromResult(
  result: Result,
  scenarioType: "CURRENT" | "CONSERVATIVE" | "STRESS" | "MAP",
): ScenarioSnapshot {
  if (!result.isCurrent) throw new Error("RESULT_SUPERSEDED");
  if (result.status !== "COMPLETED" || result.recommendation !== "BUY")
    throw new Error("RESULT_NOT_PURCHASE_READY");
  const match = result.supplierRow.matchDecision;
  if (
    !safeMatchDecision(match) ||
    match?.selectedCandidate?.packGuard?.status !== "VERIFIED"
  )
    throw new Error("PACK_OR_MATCH_NOT_VERIFIED");
  const evidence = record(result.evidence);
  const scenarios = record(evidence.scenarios);
  const scenario = record(scenarios[scenarioType]);
  const exact = record(scenario.exactValues);
  const scenarioEvidence = record(scenario.evidence);
  const priceEvidence = record(scenarioEvidence.price);
  const feeEvidence = record(scenarioEvidence.feeQuote);
  const price = string(priceEvidence.price);
  const priceCurrency = string(priceEvidence.currency);
  const feeCurrency = string(feeEvidence.currency);
  const effectiveCogs = string(exact.effectiveCogs);
  const amazonFees = string(exact.amazonFees);
  const netProfit = string(exact.netProfit);
  const supplierUnitCost =
    result.supplierRow.normalizedOffer?.unitCost?.toString();
  if (
    !price ||
    !effectiveCogs ||
    !amazonFees ||
    !netProfit ||
    !supplierUnitCost
  )
    throw new Error("SCENARIO_EVIDENCE_INCOMPLETE");
  const evidenceExpired = (value: Record<string, unknown>) =>
    string(value.freshnessState) !== "FRESH" ||
    !string(value.freshUntil) ||
    new Date(string(value.freshUntil)!).getTime() < Date.now();
  if (evidenceExpired(priceEvidence) || evidenceExpired(feeEvidence))
    throw new Error("SCENARIO_EVIDENCE_STALE");
  if (
    !priceCurrency ||
    !feeCurrency ||
    priceCurrency !== result.shippingRoute.currency ||
    feeCurrency !== result.shippingRoute.currency ||
    (result.supplierRow.normalizedOffer?.currency !== null &&
      result.supplierRow.normalizedOffer?.currency !==
        result.shippingRoute.currency)
  )
    throw new Error("SCENARIO_CURRENCY_MISMATCH");
  if (
    !exactDecimal(price)
      .minus(exactDecimal(effectiveCogs))
      .minus(exactDecimal(amazonFees))
      .eq(exactDecimal(netProfit))
  )
    throw new Error("SCENARIO_FORMULA_MISMATCH");
  return {
    price,
    effectiveCogs,
    amazonFees,
    netProfit,
    supplierUnitCost,
    currency: result.shippingRoute.currency,
  };
}
export function makeOrder(input: {
  result: Result;
  scenarioType: "CURRENT" | "CONSERVATIVE" | "STRESS" | "MAP";
  requestedUnits: number;
  minimumOrderCases: number;
  orderMultipleCases: number;
}) {
  const casePack = input.result.supplierRow.normalizedOffer?.caseCount;
  if (!casePack || casePack <= 0) throw new Error("CASE_PACK_REQUIRED");
  const scenario = scenarioFromResult(input.result, input.scenarioType);
  return buildOrderLine({
    requestedUnits: input.requestedUnits,
    casePack,
    minimumOrderCases: input.minimumOrderCases,
    orderMultipleCases: input.orderMultipleCases,
    scenario,
  });
}
export { sumOrderLines };
