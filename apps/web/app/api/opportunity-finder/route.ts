import { NextRequest, NextResponse } from "next/server";
import { ensurePhaseZeroOrganization, listNiches } from "@rizpoint/database";
import { requirePrivateAccess } from "@/src/private-access";
import { nicheListSchema } from "@/src/opportunity-finder/contracts";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const parsed = nicheListSchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!parsed.success)
    return NextResponse.json({ error: "INVALID_NICHE_QUERY" }, { status: 400 });
  const organization = await ensurePhaseZeroOrganization();
  return NextResponse.json(
    await listNiches({ organizationId: organization.id, ...parsed.data }),
  );
}
