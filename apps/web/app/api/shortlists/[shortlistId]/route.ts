import { NextRequest, NextResponse } from "next/server";
import {
  ensurePhaseZeroOrganization,
  getShortlistForOrganization,
} from "@rizpoint/database";
import { phaseZeroDemoEnabled } from "@/src/phase-zero";
export const runtime = "nodejs";
export async function GET(
  _: NextRequest,
  { params }: { params: Promise<{ shortlistId: string }> },
) {
  if (!phaseZeroDemoEnabled())
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const org = await ensurePhaseZeroOrganization();
  const shortlist = await getShortlistForOrganization(
    org.id,
    (await params).shortlistId,
  );
  return shortlist
    ? NextResponse.json(shortlist)
    : NextResponse.json({ error: "SHORTLIST_NOT_FOUND" }, { status: 404 });
}
