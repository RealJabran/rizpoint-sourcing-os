import { NextRequest, NextResponse } from "next/server";
import {
  ensurePhaseZeroOrganization,
  listProductTracker,
} from "@rizpoint/database";
import { requirePrivateAccess } from "@/src/private-access";

export const runtime = "nodejs";

function boundedInteger(
  value: string | null,
  fallback: number,
  maximum: number,
) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed)
    ? Math.min(maximum, Math.max(0, parsed))
    : fallback;
}

export async function GET(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const organization = await ensurePhaseZeroOrganization();
  const marketplaceId = request.nextUrl.searchParams
    .get("marketplaceId")
    ?.trim();
  return NextResponse.json(
    await listProductTracker({
      organizationId: organization.id,
      ...(marketplaceId ? { marketplaceId } : {}),
      offset: boundedInteger(
        request.nextUrl.searchParams.get("offset"),
        0,
        1_000_000,
      ),
      limit:
        boundedInteger(request.nextUrl.searchParams.get("limit"), 50, 100) ||
        50,
    }),
  );
}
