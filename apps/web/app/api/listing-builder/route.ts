import { NextRequest, NextResponse } from "next/server";
import {
  approveListingDraft,
  createVerifiedProductFact,
  ensurePhaseZeroOrganization,
  generateFactBoundListingDraft,
  listListingBuilderProject,
  reviseListingDraft,
} from "@rizpoint/database";
import { requirePrivateAccess } from "@/src/private-access";

export const runtime = "nodejs";
const strings = (value: unknown) =>
  Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .slice(0, 50)
    : [];

export async function GET(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId)
    return NextResponse.json({ error: "PROJECT_ID_REQUIRED" }, { status: 400 });
  const organization = await ensurePhaseZeroOrganization();
  try {
    return NextResponse.json(
      await listListingBuilderProject({
        organizationId: organization.id,
        projectId,
      }),
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "LISTING_BUILDER_UNAVAILABLE",
      },
      { status: 400 },
    );
  }
}

export async function POST(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const body = (await request.json()) as Record<string, unknown>;
  const organization = await ensurePhaseZeroOrganization();
  try {
    if (body.action === "CREATE_FACT") {
      if (
        typeof body.projectId !== "string" ||
        typeof body.factKey !== "string" ||
        typeof body.value !== "string" ||
        typeof body.evidenceReference !== "string"
      )
        throw new Error("VERIFIED_FACT_FIELDS_REQUIRED");
      const source =
        body.source === "AUTHORIZED_SOURCE"
          ? "AUTHORIZED_SOURCE"
          : "USER_VERIFIED";
      return NextResponse.json(
        await createVerifiedProductFact({
          organizationId: organization.id,
          projectId: body.projectId,
          factKey: body.factKey,
          value: body.value,
          evidenceReference: body.evidenceReference,
          source,
        }),
      );
    }
    if (body.action === "GENERATE") {
      if (typeof body.projectId !== "string")
        throw new Error("PROJECT_ID_REQUIRED");
      return NextResponse.json(
        await generateFactBoundListingDraft({
          organizationId: organization.id,
          projectId: body.projectId,
          keywords: strings(body.keywords),
          prohibitedTerms: strings(body.prohibitedTerms),
          categoryConstraints: strings(body.categoryConstraints),
          ...(typeof body.brandVoice === "string"
            ? { brandVoice: body.brandVoice }
            : {}),
          ...(typeof body.differentiationBriefNoteId === "string"
            ? { differentiationBriefNoteId: body.differentiationBriefNoteId }
            : {}),
        }),
      );
    }
    if (body.action === "REVISE") {
      const allowed = new Set([
        "title",
        "bullets",
        "description",
        "backendSearchTerms",
        "imageBrief",
        "aPlusOutline",
        "faqIdeas",
      ]);
      if (
        typeof body.draftId !== "string" ||
        typeof body.section !== "string" ||
        !allowed.has(body.section) ||
        typeof body.value !== "string"
      )
        throw new Error("DRAFT_REVISION_INVALID");
      return NextResponse.json(
        await reviseListingDraft({
          organizationId: organization.id,
          draftId: body.draftId,
          section: body.section as "title",
          value: body.value,
        }),
      );
    }
    if (body.action === "APPROVE") {
      if (typeof body.draftId !== "string")
        throw new Error("LISTING_DRAFT_ID_REQUIRED");
      return NextResponse.json(
        await approveListingDraft({
          organizationId: organization.id,
          draftId: body.draftId,
        }),
      );
    }
    throw new Error("LISTING_BUILDER_ACTION_INVALID");
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "LISTING_BUILDER_FAILED",
      },
      { status: 400 },
    );
  }
}
