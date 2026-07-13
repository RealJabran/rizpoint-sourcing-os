import { NextRequest, NextResponse } from "next/server";
import {
  ensurePhaseZeroOrganization,
  saveFinancialPolicy,
} from "@rizpoint/database";
import { PROFIT_ENGINE_VERSION } from "@rizpoint/profit-engine";
import { phaseZeroDemoEnabled } from "@/src/phase-zero";
import { financialPolicySchema } from "@/src/phase-four";

export const runtime = "nodejs";

export async function PUT(request: NextRequest) {
  if (!phaseZeroDemoEnabled())
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = financialPolicySchema.safeParse(await request.json());
  if (!parsed.success)
    return NextResponse.json(
      { error: "INVALID_FINANCIAL_POLICY" },
      { status: 400 },
    );
  const organization = await ensurePhaseZeroOrganization();
  const policy = await saveFinancialPolicy({
    organizationId: organization.id,
    currency: parsed.data.currency,
    minNetProfit: parsed.data.minNetProfit,
    minRoiPercent: parsed.data.minRoiPercent,
    minMarginPercent: parsed.data.minMarginPercent,
    maxStressLoss: parsed.data.maxStressLoss,
    stressDiscountPercent: parsed.data.stressDiscountPercent,
    ...(parsed.data.minimumDemandScore
      ? { minimumDemandScore: parsed.data.minimumDemandScore }
      : {}),
    engineVersion: PROFIT_ENGINE_VERSION,
  });
  return NextResponse.json(policy);
}
