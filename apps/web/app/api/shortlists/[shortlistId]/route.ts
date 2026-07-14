import { NextRequest, NextResponse } from "next/server";
import {
  ensurePhaseZeroOrganization,
  getShortlistForOrganization,
} from "@rizpoint/database";
import { requirePrivateAccess } from "@/src/private-access";
export const runtime = "nodejs";
export async function GET(
  _: NextRequest,
  { params }: { params: Promise<{ shortlistId: string }> },
) {
  const denied = requirePrivateAccess(_);
  if (denied) return denied;
  const org = await ensurePhaseZeroOrganization();
  const shortlist = await getShortlistForOrganization(
    org.id,
    (await params).shortlistId,
  );
  return shortlist
    ? NextResponse.json(shortlist)
    : NextResponse.json({ error: "SHORTLIST_NOT_FOUND" }, { status: 404 });
}
