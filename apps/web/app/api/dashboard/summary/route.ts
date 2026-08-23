import { NextRequest, NextResponse } from "next/server";
import {
  getDashboardResearchSummary,
  getDashboardScanSummary,
} from "@rizpoint/database";
import { requirePrivateAccess } from "@/src/private-access";
import { organizationForRequest } from "@/src/request-organization";
import { toScanSummary } from "../../../../src/scan-summary";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const organization = await organizationForRequest(request);
  const [summary, research] = await Promise.all([
    getDashboardScanSummary(organization.id),
    getDashboardResearchSummary(organization.id),
  ]);
  return NextResponse.json({
    ...summary,
    ...research,
    recentScans: summary.recentScans.map(toScanSummary),
  });
}
