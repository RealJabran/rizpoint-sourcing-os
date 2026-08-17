import { NextRequest, NextResponse } from "next/server";
import {
  ensurePhaseZeroOrganization,
  listProductExplorer,
} from "@rizpoint/database";
import { requirePrivateAccess } from "@/src/private-access";
import { productExplorerQuerySchema } from "@/src/product-explorer/contracts";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const parsed = productExplorerQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: "INVALID_PRODUCT_EXPLORER_QUERY" },
      { status: 400 },
    );
  const organization = await ensurePhaseZeroOrganization();
  const { offset, limit, ...filters } = parsed.data;
  return NextResponse.json(
    await listProductExplorer({
      organizationId: organization.id,
      offset,
      limit,
      filters,
    }),
  );
}
