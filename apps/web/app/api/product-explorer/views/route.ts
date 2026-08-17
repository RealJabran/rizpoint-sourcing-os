import { NextRequest, NextResponse } from "next/server";
import {
  ensurePhaseZeroOrganization,
  listProductExplorerViews,
  saveProductExplorerView,
} from "@rizpoint/database";
import { requirePrivateAccess } from "@/src/private-access";
import { productExplorerViewSchema } from "@/src/product-explorer/contracts";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const organization = await ensurePhaseZeroOrganization();
  return NextResponse.json(await listProductExplorerViews(organization.id));
}

export async function POST(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const parsed = productExplorerViewSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: "INVALID_PRODUCT_EXPLORER_VIEW" },
      { status: 400 },
    );
  const organization = await ensurePhaseZeroOrganization();
  return NextResponse.json(
    await saveProductExplorerView({
      organizationId: organization.id,
      name: parsed.data.name,
      queryState: parsed.data.queryState,
      ...(parsed.data.isDefault === undefined
        ? {}
        : { isDefault: parsed.data.isDefault }),
    }),
    { status: 201 },
  );
}
