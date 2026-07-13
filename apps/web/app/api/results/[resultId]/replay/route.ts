import { NextRequest, NextResponse } from "next/server";
import {
  getAnalysisResult,
  ensurePhaseZeroOrganization,
} from "@rizpoint/database";
import {
  buildScenarios,
  decide,
  PROFIT_ENGINE_VERSION,
} from "@rizpoint/profit-engine";
import { Decimal } from "decimal.js";
import { phaseZeroDemoEnabled } from "@/src/phase-zero";

export const runtime = "nodejs";

type StoredDecisionInputs = Omit<
  Parameters<typeof decide>[0],
  "currentProfit" | "conservativeProfit" | "stressProfit"
>;

function sameDecimal(left: string | null | undefined, right: string | null) {
  if (left == null || right == null) return left === right;
  return new Decimal(left).eq(new Decimal(right));
}

export async function POST(
  _: NextRequest,
  { params }: { params: Promise<{ resultId: string }> },
) {
  if (!phaseZeroDemoEnabled())
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const organization = await ensurePhaseZeroOrganization();
  const result = await getAnalysisResult(
    organization.id,
    (await params).resultId,
  );
  if (!result)
    return NextResponse.json({ error: "RESULT_NOT_FOUND" }, { status: 404 });
  if (result.engineVersion !== PROFIT_ENGINE_VERSION)
    return NextResponse.json(
      { error: "UNSUPPORTED_ENGINE_VERSION" },
      { status: 409 },
    );
  const evidence = result.evidence as {
    current?: Parameters<typeof buildScenarios>[0]["current"];
    conservative?: Parameters<typeof buildScenarios>[0]["conservative"];
    fees?: Parameters<typeof buildScenarios>[0]["feeQuote"];
    packGuard?: {
      status?: Parameters<typeof buildScenarios>[0]["packGuardStatus"];
    };
    calculatedAt?: string;
    decisionInputs?: StoredDecisionInputs;
  };
  const input = result.inputSnapshot as {
    costs?: Parameters<typeof buildScenarios>[0]["costs"];
    policy?: { stressDiscountPercent?: string };
  };
  if (
    !evidence.current ||
    !evidence.conservative ||
    !evidence.fees ||
    !evidence.packGuard?.status ||
    !evidence.calculatedAt ||
    !evidence.decisionInputs ||
    !input.costs ||
    !input.policy?.stressDiscountPercent
  )
    return NextResponse.json(
      { error: "REPLAY_INPUT_INCOMPLETE" },
      { status: 409 },
    );
  const scenarios = buildScenarios({
    current: evidence.current,
    conservative: evidence.conservative,
    feeQuote: evidence.fees,
    costs: input.costs,
    packGuardStatus: evidence.packGuard.status,
    stressDiscountPercent: input.policy.stressDiscountPercent,
    calculatedAt: new Date(evidence.calculatedAt),
  });
  if (!scenarios.CURRENT || !scenarios.CONSERVATIVE || !scenarios.STRESS)
    return NextResponse.json(
      { error: "REPLAY_SCENARIOS_INCOMPLETE" },
      { status: 409 },
    );
  const decision = decide({
    currentProfit: scenarios.CURRENT,
    conservativeProfit: scenarios.CONSERVATIVE,
    stressProfit: scenarios.STRESS,
    ...evidence.decisionInputs,
  });
  const persisted = {
    currentNetProfit: result.currentNetProfit?.toString() ?? null,
    conservativeNetProfit: result.conservativeNetProfit?.toString() ?? null,
    stressNetProfit: result.stressNetProfit?.toString() ?? null,
    effectiveCogs: result.effectiveCogs?.toString() ?? null,
    amazonFees: result.amazonFees?.toString() ?? null,
    roiPercent: result.roiPercent?.toString() ?? null,
    marginPercent: result.marginPercent?.toString() ?? null,
    breakEvenPrice: result.breakEvenPrice?.toString() ?? null,
    recommendation: result.recommendation,
    reasonCodes: result.reasonCodes,
  };
  const replayed = {
    currentNetProfit: scenarios.CURRENT.exactValues?.netProfit ?? null,
    conservativeNetProfit:
      scenarios.CONSERVATIVE.exactValues?.netProfit ?? null,
    stressNetProfit: scenarios.STRESS.exactValues?.netProfit ?? null,
    effectiveCogs: scenarios.CURRENT.exactValues?.effectiveCogs ?? null,
    amazonFees: scenarios.CURRENT.exactValues?.amazonFees ?? null,
    roiPercent: scenarios.CURRENT.roiPercent ?? null,
    marginPercent: scenarios.CURRENT.marginPercent ?? null,
    breakEvenPrice: scenarios.CURRENT.breakEvenPrice ?? null,
    recommendation: decision.recommendation,
    reasonCodes: [
      ...scenarios.CURRENT.reasonCodes,
      ...scenarios.CONSERVATIVE.reasonCodes,
      ...scenarios.STRESS.reasonCodes,
      ...decision.reasonCodes,
      ...decision.failedRules,
    ],
  };
  const matchesPersisted =
    sameDecimal(persisted.currentNetProfit, replayed.currentNetProfit) &&
    sameDecimal(
      persisted.conservativeNetProfit,
      replayed.conservativeNetProfit,
    ) &&
    sameDecimal(persisted.stressNetProfit, replayed.stressNetProfit) &&
    sameDecimal(persisted.effectiveCogs, replayed.effectiveCogs) &&
    sameDecimal(persisted.amazonFees, replayed.amazonFees) &&
    sameDecimal(persisted.roiPercent, replayed.roiPercent) &&
    sameDecimal(persisted.marginPercent, replayed.marginPercent) &&
    sameDecimal(persisted.breakEvenPrice, replayed.breakEvenPrice) &&
    persisted.recommendation === replayed.recommendation &&
    JSON.stringify(persisted.reasonCodes) ===
      JSON.stringify(replayed.reasonCodes);
  return NextResponse.json({
    engineVersion: PROFIT_ENGINE_VERSION,
    matchesPersisted,
    persisted,
    replayed,
    scenarios,
    decision,
  });
}
