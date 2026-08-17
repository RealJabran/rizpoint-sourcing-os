import { NextRequest, NextResponse } from "next/server";
import {
  ensurePhaseZeroOrganization,
  getNicheDetail,
} from "@rizpoint/database";
import { requirePrivateAccess } from "@/src/private-access";
export const runtime = "nodejs";
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ nicheId: string }> },
) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const organization = await ensurePhaseZeroOrganization();
  const { nicheId } = await context.params;
  const detail = await getNicheDetail({
    organizationId: organization.id,
    nicheId,
  });
  return detail
    ? NextResponse.json(detail)
    : NextResponse.json({ error: "NICHE_NOT_FOUND" }, { status: 404 });
}
