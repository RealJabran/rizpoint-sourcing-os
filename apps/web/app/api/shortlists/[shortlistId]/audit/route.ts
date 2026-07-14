import { NextRequest, NextResponse } from "next/server";
import {
  ensurePhaseZeroOrganization,
  listWorkflowAuditEvents,
} from "@rizpoint/database";
import { requirePrivateAccess } from "@/src/private-access";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ shortlistId: string }> },
) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const organization = await ensurePhaseZeroOrganization();
  return NextResponse.json(
    await listWorkflowAuditEvents({
      organizationId: organization.id,
      entityType: "SHORTLIST",
      entityId: (await params).shortlistId,
    }),
  );
}
