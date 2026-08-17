import { NextRequest, NextResponse } from "next/server";
import {
  derivedProductRelationships,
  ensurePhaseZeroOrganization,
} from "@rizpoint/database";
import { requirePrivateAccess } from "@/src/private-access";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const catalogProductId = request.nextUrl.searchParams.get("productId");
  if (!catalogProductId)
    return NextResponse.json({ error: "PRODUCT_ID_REQUIRED" }, { status: 400 });
  const type = request.nextUrl.searchParams.get("type");
  if (type && type !== "SHARED_KEYWORD" && type !== "SHARED_MARKET")
    return NextResponse.json(
      { error: "RELATIONSHIP_TYPE_INVALID" },
      { status: 400 },
    );
  const organization = await ensurePhaseZeroOrganization();
  const types = type
    ? ([type] as Array<"SHARED_KEYWORD" | "SHARED_MARKET">)
    : undefined;
  const rows = await derivedProductRelationships({
    organizationId: organization.id,
    catalogProductId,
    ...(types ? { types } : {}),
  });
  return NextResponse.json({
    source: "DERIVED",
    rows: rows.map((row) => ({
      ...row,
      observedAt: row.observedAt.toISOString(),
    })),
  });
}
