import { NextRequest, NextResponse } from "next/server";
import {
  ensurePhaseZeroOrganization,
  listAnalysisViews,
  saveAnalysisView,
} from "@rizpoint/database";
import { phaseZeroDemoEnabled } from "@/src/phase-zero";
import { saveAnalysisViewSchema } from "@/src/analysis/contracts";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!phaseZeroDemoEnabled())
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const scanId = request.nextUrl.searchParams.get("scanId");
  if (!scanId)
    return NextResponse.json({ error: "SCAN_ID_REQUIRED" }, { status: 400 });
  const organization = await ensurePhaseZeroOrganization();
  return NextResponse.json(await listAnalysisViews(organization.id, scanId));
}

export async function POST(request: NextRequest) {
  if (!phaseZeroDemoEnabled())
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await request.json().catch(() => null);
  const parsed = saveAnalysisViewSchema.safeParse(body);
  if (!parsed.success || !body || typeof body.scanId !== "string")
    return NextResponse.json(
      { error: "INVALID_ANALYSIS_VIEW" },
      { status: 400 },
    );
  const organization = await ensurePhaseZeroOrganization();
  return NextResponse.json(
    await saveAnalysisView({
      organizationId: organization.id,
      scanJobId: body.scanId,
      ...parsed.data,
    }),
    { status: 201 },
  );
}
