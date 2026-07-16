import { NextRequest, NextResponse } from "next/server";
import {
  ensurePhaseZeroOrganization,
  queueNextScanStage,
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
  const result = await queueNextScanStage(
    organization.id,
    (await params).scanId,
  );
  if (!result)
    return NextResponse.json(
      { error: "SCAN_CONFIGURATION_OR_STATE_INVALID" },
      { status: 409 },
    );
  if (result.stage === "MAPPING_REQUIRED")
    return NextResponse.json({ error: "MAPPING_NOT_READY" }, { status: 409 });
  if (result.stage === "FAILED")
    return NextResponse.json(
      { error: "CATALOG_REJECTED_REUPLOAD_REQUIRED" },
      { status: 409 },
    );
  return NextResponse.json(result, {
    status: result.stage === "COMPLETE" ? 200 : 202,
  });
}
