import { NextRequest, NextResponse } from "next/server";
import { ensurePhaseZeroOrganization, queueMatching } from "@rizpoint/database";
import { phaseZeroDemoEnabled } from "@/src/phase-zero";

export const runtime = "nodejs";

export async function POST(
  _: NextRequest,
  { params }: { params: Promise<{ scanId: string }> },
) {
  if (!phaseZeroDemoEnabled())
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const organization = await ensurePhaseZeroOrganization();
  const scan = await queueMatching(organization.id, (await params).scanId);
  return scan
    ? NextResponse.json(scan, { status: 202 })
    : NextResponse.json({ error: "SCAN_NOT_READY" }, { status: 409 });
}
