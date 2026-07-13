import { NextRequest, NextResponse } from "next/server";
import {
  ensurePhaseZeroOrganization,
  queueProfitCalculation,
} from "@rizpoint/database";
import { phaseZeroDemoEnabled } from "@/src/phase-zero";

export const runtime = "nodejs";

export async function POST(
  _: NextRequest,
  { params }: { params: Promise<{ scanId: string }> },
) {
  if (!phaseZeroDemoEnabled())
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const organization = await ensurePhaseZeroOrganization();
  const run = await queueProfitCalculation(
    organization.id,
    (await params).scanId,
  );
  return run
    ? NextResponse.json({ id: run.id, status: run.status }, { status: 202 })
    : NextResponse.json(
        { error: "FINANCIAL_POLICY_ROUTE_OR_SCAN_NOT_READY" },
        { status: 409 },
      );
}
