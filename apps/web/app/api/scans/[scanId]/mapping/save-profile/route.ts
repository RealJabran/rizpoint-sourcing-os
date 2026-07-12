import { NextRequest, NextResponse } from "next/server";
import {
  ensurePhaseZeroOrganization,
  getScanJobForOrganization,
  saveSheetProfile,
} from "@rizpoint/database";
import { phaseZeroDemoEnabled } from "@/src/phase-zero";
import { profileInputSchema, validateMappings } from "@/src/phase-one";
export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ scanId: string }> },
) {
  if (!phaseZeroDemoEnabled())
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = profileInputSchema.safeParse(await request.json());
  if (!parsed.success)
    return NextResponse.json({ error: "INVALID_PROFILE" }, { status: 400 });
  try {
    validateMappings(parsed.data.mapping);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "INVALID_PROFILE" },
      { status: 400 },
    );
  }
  const organization = await ensurePhaseZeroOrganization();
  const scan = await getScanJobForOrganization(
    organization.id,
    (await params).scanId,
  );
  if (!scan?.supplierId)
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const profile = await saveSheetProfile(
    organization.id,
    scan.supplierId,
    parsed.data.name,
    parsed.data.headerRow,
    parsed.data.mapping,
  );
  return profile
    ? NextResponse.json(profile)
    : NextResponse.json({ error: "Not found" }, { status: 404 });
}
