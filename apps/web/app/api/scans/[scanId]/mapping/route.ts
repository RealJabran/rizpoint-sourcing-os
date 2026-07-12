import { NextRequest, NextResponse } from "next/server";
import {
  ensurePhaseZeroOrganization,
  saveColumnMappings,
} from "@rizpoint/database";
import { phaseZeroDemoEnabled } from "@/src/phase-zero";
import { mappingInputSchema, validateMappings } from "@/src/phase-one";

export const runtime = "nodejs";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ scanId: string }> },
) {
  if (!phaseZeroDemoEnabled())
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = mappingInputSchema.safeParse(await request.json());
  if (!parsed.success)
    return NextResponse.json({ error: "INVALID_MAPPING" }, { status: 400 });
  try {
    validateMappings(parsed.data.mappings);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "INVALID_MAPPING" },
      { status: 400 },
    );
  }
  const organization = await ensurePhaseZeroOrganization();
  const scan = await saveColumnMappings(
    organization.id,
    (await params).scanId,
    parsed.data.uploadSheetId,
    parsed.data.headerRow,
    parsed.data.mappings,
  );
  return scan
    ? NextResponse.json(scan)
    : NextResponse.json({ error: "Not found" }, { status: 404 });
}
