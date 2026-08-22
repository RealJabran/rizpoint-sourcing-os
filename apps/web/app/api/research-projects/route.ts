import { NextRequest, NextResponse } from "next/server";
import { researchRepository } from "@rizpoint/database";
import { requirePrivateAccess } from "@/src/private-access";
import { organizationForRequest } from "@/src/request-organization";
import { createResearchProjectSchema } from "@/src/product-explorer/contracts";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const organization = await organizationForRequest(request);
  return NextResponse.json(
    await researchRepository.listProjects(
      organization.id,
      request.nextUrl.searchParams.get("marketplaceId") ?? undefined,
    ),
  );
}

export async function POST(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const parsed = createResearchProjectSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: "INVALID_RESEARCH_PROJECT" },
      { status: 400 },
    );
  const organization = await organizationForRequest(request);
  return NextResponse.json(
    await researchRepository.createProject({
      organizationId: organization.id,
      name: parsed.data.name,
      marketplaceId: parsed.data.marketplaceId,
      mode: parsed.data.mode,
      ...(parsed.data.description === undefined
        ? {}
        : { description: parsed.data.description }),
    }),
    { status: 201 },
  );
}
