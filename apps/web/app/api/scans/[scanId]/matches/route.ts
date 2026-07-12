import { NextRequest, NextResponse } from "next/server";
import {
  ensurePhaseZeroOrganization,
  listMatchDecisions,
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
  return NextResponse.json(
    await listMatchDecisions(organization.id, (await params).scanId),
  );
}
