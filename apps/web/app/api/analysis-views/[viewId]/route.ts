import { NextRequest, NextResponse } from "next/server";
import {
  deleteAnalysisView,
  ensurePhaseZeroOrganization,
} from "@rizpoint/database";
import { phaseZeroDemoEnabled } from "@/src/phase-zero";

export const runtime = "nodejs";

export async function DELETE(
  _: NextRequest,
  { params }: { params: Promise<{ viewId: string }> },
) {
  if (!phaseZeroDemoEnabled())
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const organization = await ensurePhaseZeroOrganization();
  const result = await deleteAnalysisView(
    organization.id,
    (await params).viewId,
  );
  return result.count
    ? NextResponse.json({ deleted: true })
    : NextResponse.json({ error: "VIEW_NOT_FOUND" }, { status: 404 });
}
