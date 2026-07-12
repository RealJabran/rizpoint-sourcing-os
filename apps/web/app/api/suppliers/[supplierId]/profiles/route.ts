import { NextRequest, NextResponse } from "next/server";
import {
  ensurePhaseZeroOrganization,
  listSheetProfiles,
} from "@rizpoint/database";
import { phaseZeroDemoEnabled } from "@/src/phase-zero";

export const runtime = "nodejs";

export async function GET(
  _: NextRequest,
  { params }: { params: Promise<{ supplierId: string }> },
) {
  if (!phaseZeroDemoEnabled())
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const organization = await ensurePhaseZeroOrganization();
  const profiles = await listSheetProfiles(
    organization.id,
    (await params).supplierId,
  );
  return profiles
    ? NextResponse.json(profiles)
    : NextResponse.json({ error: "Not found" }, { status: 404 });
}
