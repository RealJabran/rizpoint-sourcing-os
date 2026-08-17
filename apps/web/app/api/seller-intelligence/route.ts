import { NextRequest, NextResponse } from "next/server";
import {
  ensurePhaseZeroOrganization,
  listSellerIntelligence,
} from "@rizpoint/database";
import { requirePrivateAccess } from "@/src/private-access";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const org = await ensurePhaseZeroOrganization();
  const query = request.nextUrl.searchParams.get("q")?.trim() || undefined;
  const rows = await listSellerIntelligence({ organizationId: org.id, query });
  return NextResponse.json({
    universe: "Authorized seller observations for this organization",
    rows: rows.map((row) => ({
      ...row,
      knownProductCount: row.knownProductCount?.toString() ?? null,
      observedAt: row.observedAt.toISOString(),
    })),
  });
}
