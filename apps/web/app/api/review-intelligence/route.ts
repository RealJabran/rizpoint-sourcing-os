import { NextRequest, NextResponse } from "next/server";
import {
  ensurePhaseZeroOrganization,
  ingestAuthorizedReview,
  listReviewIntelligence,
  rebuildReviewThemes,
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
  const result = await listReviewIntelligence({
    organizationId: organization.id,
    catalogProductId,
  });
  return NextResponse.json({
    themes: result.themes.map((theme) => ({
      ...theme,
      averageRating: theme.averageRating?.toString() ?? null,
      calculatedAt: theme.calculatedAt.toISOString(),
    })),
    reviews: result.reviews.map((review) => ({
      ...review,
      observedAt: review.observedAt.toISOString(),
    })),
  });
}

export async function POST(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const body = (await request.json()) as Record<string, unknown>;
  const organization = await ensurePhaseZeroOrganization();
  const catalogProductId =
    typeof body.catalogProductId === "string" ? body.catalogProductId : "";
  if (!catalogProductId)
    return NextResponse.json({ error: "PRODUCT_ID_REQUIRED" }, { status: 400 });
  if (body.action === "REBUILD_THEMES") {
    const result = await rebuildReviewThemes({
      organizationId: organization.id,
      catalogProductId,
    });
    return NextResponse.json({ themeCount: result.themes.length });
  }
  if (body.action !== "INGEST")
    return NextResponse.json(
      { error: "REVIEW_ACTION_INVALID" },
      { status: 400 },
    );
  const source = body.source;
  if (
    source !== "LICENSED_PROVIDER" &&
    source !== "USER_IMPORT" &&
    source !== "AUTHORIZED_OTHER"
  )
    return NextResponse.json(
      { error: "REVIEW_SOURCE_INVALID" },
      { status: 400 },
    );
  const rating = typeof body.rating === "number" ? body.rating : Number.NaN;
  const reference =
    typeof body.sourceReference === "string" ? body.sourceReference : "";
  const reviewBody = typeof body.body === "string" ? body.body : "";
  const observedAt =
    typeof body.observedAt === "string"
      ? new Date(body.observedAt)
      : new Date();
  if (!reference || !reviewBody || Number.isNaN(observedAt.getTime()))
    return NextResponse.json(
      { error: "REVIEW_INPUT_INVALID" },
      { status: 400 },
    );
  const review = await ingestAuthorizedReview({
    organizationId: organization.id,
    catalogProductId,
    source,
    sourceReference: reference,
    rating,
    body: reviewBody,
    observedAt,
    ...(typeof body.language === "string" ? { language: body.language } : {}),
  });
  return NextResponse.json({
    id: review.id,
    deduplicated: review.createdAt.getTime() !== review.observedAt.getTime(),
  });
}
