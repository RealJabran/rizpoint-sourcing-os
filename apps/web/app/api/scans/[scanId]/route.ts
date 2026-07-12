import { NextRequest, NextResponse } from "next/server";
import {
  getScanJobForOrganization,
  ensurePhaseZeroOrganization,
} from "@rizpoint/database";
import { phaseZeroDemoEnabled } from "@/src/phase-zero";

export const runtime = "nodejs";

export async function GET(
  _: NextRequest,
  { params }: { params: Promise<{ scanId: string }> },
) {
  if (!phaseZeroDemoEnabled())
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const organization = await ensurePhaseZeroOrganization();
  const scan = await getScanJobForOrganization(
    organization.id,
    (await params).scanId,
  );
  return scan
    ? NextResponse.json(scan)
    : NextResponse.json({ error: "Not found" }, { status: 404 });
}
