import { NextRequest, NextResponse } from "next/server";
import { assessListing, ensurePhaseZeroOrganization } from "@rizpoint/database";
import { requirePrivateAccess } from "@/src/private-access";

export const runtime = "nodejs";

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .slice(0, 50)
    : [];
}

export async function POST(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const body = (await request.json()) as Record<string, unknown>;
  const catalogProductId =
    typeof body.catalogProductId === "string" ? body.catalogProductId : "";
  const title = typeof body.title === "string" ? body.title : "";
  if (!catalogProductId || !title.trim())
    return NextResponse.json(
      { error: "PRODUCT_AND_DRAFT_TITLE_REQUIRED" },
      { status: 400 },
    );
  const organization = await ensurePhaseZeroOrganization();
  try {
    const result = await assessListing({
      organizationId: organization.id,
      catalogProductId,
      draft: {
        title,
        bullets: stringList(body.bullets),
        description:
          typeof body.description === "string" ? body.description : "",
        targetKeywords: stringList(body.targetKeywords),
        prohibitedTerms: stringList(body.prohibitedTerms),
      },
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "LISTING_ASSESSMENT_FAILED",
      },
      { status: 400 },
    );
  }
}
