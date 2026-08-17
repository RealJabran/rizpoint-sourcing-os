import { NextRequest, NextResponse } from "next/server";
import {
  ensurePhaseZeroOrganization,
  listBrandIntelligence,
} from "@rizpoint/database";
import { requirePrivateAccess } from "@/src/private-access";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const org = await ensurePhaseZeroOrganization();
  const rows = await listBrandIntelligence(org.id);
  return NextResponse.json(
    rows.map((row) => ({
      brand: row.brand,
      productCount: Number(row.productCount),
      medianPrice: row.medianPrice?.toString() ?? null,
      universe:
        "Organization tracked / imported / watched / market-member products",
    })),
  );
}
