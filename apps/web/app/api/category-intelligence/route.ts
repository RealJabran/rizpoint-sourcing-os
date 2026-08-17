import { NextRequest, NextResponse } from "next/server";
import {
  ensurePhaseZeroOrganization,
  listCategoryIntelligence,
} from "@rizpoint/database";
import { requirePrivateAccess } from "@/src/private-access";
import { categoryListQuerySchema } from "@/src/category-intelligence/contracts";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const parsed = categoryListQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: "INVALID_CATEGORY_QUERY" },
      { status: 400 },
    );
  const organization = await ensurePhaseZeroOrganization();
  return NextResponse.json(
    await listCategoryIntelligence({
      organizationId: organization.id,
      ...parsed.data,
    }),
  );
}
