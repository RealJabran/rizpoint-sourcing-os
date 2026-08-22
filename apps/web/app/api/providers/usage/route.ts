import { NextRequest, NextResponse } from "next/server";
import { getProviderUsageSummary } from "@rizpoint/database";
import { requirePrivateAccess } from "@/src/private-access";
import { organizationForRequest } from "@/src/request-organization";

export const runtime = "nodejs";

/** Credential-free, tenant-scoped operational totals. This route never reads
 * cache projections, provider payloads, request inputs, or connection secrets. */
export async function GET(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const organization = await organizationForRequest(request);
  return NextResponse.json(
    await getProviderUsageSummary({ organizationId: organization.id }),
    { headers: { "cache-control": "no-store" } },
  );
}
