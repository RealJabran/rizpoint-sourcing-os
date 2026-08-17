import { NextRequest, NextResponse } from "next/server";
import {
  ensurePhaseZeroOrganization,
  estimateSalesForAsin,
} from "@rizpoint/database";
import { requirePrivateAccess } from "@/src/private-access";
import { salesEstimateRequestSchema } from "@/src/sales-estimation/contracts";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const parsed = salesEstimateRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: "INVALID_SALES_ESTIMATE_REQUEST" },
      { status: 400 },
    );
  const organization = await ensurePhaseZeroOrganization();
  return NextResponse.json(
    await estimateSalesForAsin({
      organizationId: organization.id,
      asin: parsed.data.asin,
    }),
  );
}
