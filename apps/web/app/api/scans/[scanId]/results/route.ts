import { NextRequest, NextResponse } from "next/server";
import {
  ensurePhaseZeroOrganization,
  listAnalysisResults,
} from "@rizpoint/database";
import { phaseZeroDemoEnabled } from "@/src/phase-zero";
import { analysisQuerySchema } from "@/src/analysis/contracts";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ scanId: string }> },
) {
  if (!phaseZeroDemoEnabled())
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = analysisQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: "INVALID_ANALYSIS_QUERY" },
      { status: 400 },
    );
  const organization = await ensurePhaseZeroOrganization();
  const results = await listAnalysisResults({
    organizationId: organization.id,
    scanJobId: (await params).scanId,
    ...parsed.data,
    filters: {
      recommendation: parsed.data.recommendation,
      status: parsed.data.status,
      search: parsed.data.search,
      minRoiPercent: parsed.data.minRoiPercent,
      maxRoiPercent: parsed.data.maxRoiPercent,
      featuredOfferState: parsed.data.featuredOfferState,
      amazonRetailPresence: parsed.data.amazonRetailPresence,
      pricingCompleteness: parsed.data.pricingCompleteness,
      feeCompleteness: parsed.data.feeCompleteness,
      restrictionState: parsed.data.restrictionState,
      restrictionReasonCode: parsed.data.restrictionReasonCode,
      minFbaOfferCount: parsed.data.minFbaOfferCount,
      maxFbaOfferCount: parsed.data.maxFbaOfferCount,
      minFbmOfferCount: parsed.data.minFbmOfferCount,
      maxFbmOfferCount: parsed.data.maxFbmOfferCount,
    },
  });
  return results
    ? NextResponse.json(results)
    : NextResponse.json({ error: "Not found" }, { status: 404 });
}
