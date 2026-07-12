import { NextRequest, NextResponse } from "next/server";
import {
  ensurePhaseZeroOrganization,
  getScanJobForOrganization,
  saveSheetProfile,
} from "@rizpoint/database";
import { phaseZeroDemoEnabled } from "@/src/phase-zero";
import { z } from "zod";

const profileSchema = z.object({
  name: z.string().min(1).max(100),
  headerRow: z.number().int().positive(),
  mapping: z.array(
    z.object({
      sourceIndex: z.number().int(),
      sourceColumn: z.string(),
      target: z.string(),
      required: z.boolean(),
    }),
  ),
});
export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ scanId: string }> },
) {
  if (!phaseZeroDemoEnabled())
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = profileSchema.safeParse(await request.json());
  if (!parsed.success)
    return NextResponse.json({ error: "INVALID_PROFILE" }, { status: 400 });
  const organization = await ensurePhaseZeroOrganization();
  const scan = await getScanJobForOrganization(
    organization.id,
    (await params).scanId,
  );
  if (!scan?.supplierId)
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(
    await saveSheetProfile(
      organization.id,
      scan.supplierId,
      parsed.data.name,
      parsed.data.headerRow,
      parsed.data.mapping,
    ),
  );
}
