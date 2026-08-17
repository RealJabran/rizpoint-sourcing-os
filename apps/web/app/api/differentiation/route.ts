import { NextRequest, NextResponse } from "next/server";
import {
  createDifferentiationBrief,
  ensurePhaseZeroOrganization,
  exportDifferentiationBrief,
} from "@rizpoint/database";
import { requirePrivateAccess } from "@/src/private-access";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const catalogProductId = request.nextUrl.searchParams.get("productId");
  if (!catalogProductId)
    return NextResponse.json({ error: "PRODUCT_ID_REQUIRED" }, { status: 400 });
  const organization = await ensurePhaseZeroOrganization();
  try {
    return NextResponse.json(
      await createDifferentiationBrief({
        organizationId: organization.id,
        catalogProductId,
      }),
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "BRIEF_UNAVAILABLE" },
      { status: 400 },
    );
  }
}

export async function POST(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const body = (await request.json()) as {
    catalogProductId?: unknown;
    projectId?: unknown;
  };
  if (
    typeof body.catalogProductId !== "string" ||
    typeof body.projectId !== "string"
  )
    return NextResponse.json(
      { error: "PRODUCT_AND_PROJECT_REQUIRED" },
      { status: 400 },
    );
  const organization = await ensurePhaseZeroOrganization();
  try {
    const brief = await createDifferentiationBrief({
      organizationId: organization.id,
      catalogProductId: body.catalogProductId,
    });
    const note = await exportDifferentiationBrief({
      organizationId: organization.id,
      projectId: body.projectId,
      brief,
    });
    return NextResponse.json({ noteId: note.id });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "BRIEF_EXPORT_FAILED" },
      { status: 400 },
    );
  }
}
