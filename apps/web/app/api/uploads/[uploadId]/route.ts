import { NextRequest, NextResponse } from "next/server";
import {
  ensurePhaseZeroOrganization,
  getUploadForOrganization,
} from "@rizpoint/database";
import { phaseZeroDemoEnabled } from "@/src/phase-zero";

export const runtime = "nodejs";

export async function GET(
  _: NextRequest,
  { params }: { params: Promise<{ uploadId: string }> },
) {
  if (!phaseZeroDemoEnabled())
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const organization = await ensurePhaseZeroOrganization();
  const upload = await getUploadForOrganization(
    organization.id,
    (await params).uploadId,
  );
  return upload
    ? NextResponse.json(upload)
    : NextResponse.json({ error: "Not found" }, { status: 404 });
}
