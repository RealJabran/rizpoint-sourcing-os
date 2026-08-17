import { NextRequest, NextResponse } from "next/server";
import {
  createNicheDefinition,
  ensurePhaseZeroOrganization,
  recalculateNicheAssessment,
} from "@rizpoint/database";
import { requirePrivateAccess } from "@/src/private-access";
import { nicheActionSchema } from "@/src/opportunity-finder/contracts";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const parsed = nicheActionSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: "INVALID_NICHE_ACTION" },
      { status: 400 },
    );
  const organization = await ensurePhaseZeroOrganization();
  try {
    if (parsed.data.action === "RECALCULATE")
      return NextResponse.json(
        await recalculateNicheAssessment({
          organizationId: organization.id,
          nicheId: parsed.data.nicheId,
          thresholds: {
            lowReviewMaximum: parsed.data.lowReviewMaximum ?? "100",
            stablePriceVolatilityMaximum:
              parsed.data.stablePriceVolatilityMaximum ?? "15",
            minimumConfidencePercent:
              parsed.data.minimumConfidencePercent ?? "60",
          },
        }),
      );
    const source = parsed.data.sourceType;
    const value = parsed.data.value;
    const definition =
      source === "CATEGORY"
        ? {
            kind: "NICHE" as const,
            sourceType: source,
            categoryReference: value,
          }
        : source === "SEED_KEYWORD"
          ? { kind: "NICHE" as const, sourceType: source, seedKeyword: value }
          : source === "KEYWORD_CLUSTER"
            ? {
                kind: "NICHE" as const,
                sourceType: source,
                keywords: value
                  .split(",")
                  .map((v) => v.trim())
                  .filter(Boolean),
              }
            : source === "MANUAL_COMPETITORS"
              ? {
                  kind: "NICHE" as const,
                  sourceType: source,
                  competitorProductIds: value
                    .split(",")
                    .map((v) => v.trim())
                    .filter(Boolean),
                }
              : {
                  kind: "NICHE" as const,
                  sourceType: source,
                  sourceMarketDefinitionId: value,
                };
    const niche = await createNicheDefinition({
      organizationId: organization.id,
      marketplaceId: parsed.data.marketplaceId,
      name: parsed.data.name,
      definition,
    });
    const assessment = await recalculateNicheAssessment({
      organizationId: organization.id,
      nicheId: niche.id,
    });
    return NextResponse.json({ niche, assessment });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "NICHE_ACTION_FAILED" },
      { status: 400 },
    );
  }
}
