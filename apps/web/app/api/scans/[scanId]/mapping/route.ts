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
  const body = await request.json().catch(() => null);
  const parsed = mappingInputSchema.safeParse(body);
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
  try {
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
  } catch (error) {
    const code = error instanceof Error ? error.message : "INVALID_MAPPING";
    if (["MAPPING_STALE_SELECTION", "MAPPING_NOT_READY"].includes(code))
      return NextResponse.json({ error: code }, { status: 409 });
    return NextResponse.json({ error: "INVALID_MAPPING" }, { status: 400 });
  }
}
