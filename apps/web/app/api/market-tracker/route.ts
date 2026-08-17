import { NextRequest, NextResponse } from "next/server";
import {
  ensurePhaseZeroOrganization,
  listMarketTracker,
} from "@rizpoint/database";
import { requirePrivateAccess } from "@/src/private-access";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const org = await ensurePhaseZeroOrganization();
  return NextResponse.json(await listMarketTracker(org.id));
}
