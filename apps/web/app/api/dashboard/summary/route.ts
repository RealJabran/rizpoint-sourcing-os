import { NextResponse } from "next/server";
import {
  ensurePhaseZeroOrganization,
  getDashboardScanSummary,
} from "@rizpoint/database";
import { phaseZeroDemoEnabled } from "@/src/phase-zero";
import { toScanSummary } from "../../../../src/scan-summary";

export const runtime = "nodejs";

export async function GET() {
  if (!phaseZeroDemoEnabled())
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const organization = await ensurePhaseZeroOrganization();
  const summary = await getDashboardScanSummary(organization.id);
  return NextResponse.json({
    ...summary,
    recentScans: summary.recentScans.map(toScanSummary),
  });
}
