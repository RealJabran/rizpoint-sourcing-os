import { NextRequest, NextResponse } from "next/server";
import { db, researchRepository } from "@rizpoint/database";
import { verifyResearchCompanionSession } from "@/src/research-companion-session";
import { enforceApiRateLimit } from "@/src/api-rate-limit";
export const runtime = "nodejs";
const marketplaces: Record<string, string> = {
  "amazon.com": "ATVPDKIKX0DER",
  "amazon.co.uk": "A1F83G8C2ARO7P",
  "amazon.de": "A1PA6795UKMFR9",
  "amazon.ca": "A2EUQ1WTGCTBG2",
};
function principal(request: NextRequest) {
  const token =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return verifyResearchCompanionSession(token);
}
function asin(value: unknown) {
  return typeof value === "string" && /^[A-Z0-9]{10}$/i.test(value)
    ? value.toUpperCase()
    : "";
}
export async function POST(request: NextRequest) {
  const session = principal(request);
  if (!session)
    return NextResponse.json(
      { error: "COMPANION_SESSION_INVALID_OR_EXPIRED" },
      { status: 401 },
    );
  const limited = await enforceApiRateLimit({
    request,
    organizationId: session.organizationId,
    scope: "research.companion",
    limit: 60,
    windowSeconds: 60,
  });
  if (limited) return limited;
  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const targetAsin = asin(body?.asin);
  const url = typeof body?.url === "string" ? body.url : "";
  if (!targetAsin)
    return NextResponse.json({ error: "ASIN_REQUIRED" }, { status: 400 });
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    /* ASIN-only requests are valid */
  }
  const marketplaceId =
    marketplaces[host] ??
    (typeof body?.marketplaceId === "string"
      ? body.marketplaceId
      : "ATVPDKIKX0DER");
  const product = await db.catalogProduct.findFirst({
    where: {
      asin: targetAsin,
      ...(marketplaceId ? { marketplaceId } : {}),
      OR: [
        {
          listingCandidates: {
            some: { organizationId: session.organizationId },
          },
        },
        {
          researchProjectItems: {
            some: { organizationId: session.organizationId },
          },
        },
        {
          productWatches: { some: { organizationId: session.organizationId } },
        },
        { marketMembers: { some: { organizationId: session.organizationId } } },
        {
          historyRefreshItems: {
            some: { organizationId: session.organizationId },
          },
        },
      ],
    },
    include: {
      salesEstimates: {
        where: { organizationId: session.organizationId },
        orderBy: { observedAt: "desc" },
        take: 1,
      },
      complianceRiskAssessments: {
        where: { organizationId: session.organizationId },
        orderBy: { calculatedAt: "desc" },
        take: 1,
      },
      opportunityAssessments: {
        where: { organizationId: session.organizationId },
        orderBy: { calculatedAt: "desc" },
        take: 1,
      },
    },
  });
  const action = body?.action;
  if (action === "save" || action === "watch") {
    const projectId =
      typeof body?.projectId === "string" ? body.projectId : undefined;
    if (!product)
      return NextResponse.json(
        { error: "PRODUCT_NOT_YET_AVAILABLE_FOR_ACTION" },
        { status: 409 },
      );
    if (action === "save") {
      if (!projectId)
        return NextResponse.json(
          { error: "PROJECT_ID_REQUIRED" },
          { status: 400 },
        );
      await researchRepository.addProjectItem({
        organizationId: session.organizationId,
        projectId,
        kind: "PRODUCT",
        subjectKey: product.id,
        catalogProductId: product.id,
        displayLabel: product.title,
      });
    } else
      await researchRepository.createProductWatch({
        organizationId: session.organizationId,
        ...(projectId ? { projectId } : {}),
        catalogProductId: product.id,
        marketplaceId,
      });
  }
  return NextResponse.json({
    target: { asin: targetAsin, marketplaceId, url },
    product: product
      ? {
          id: product.id,
          title: product.title,
          brand: product.brand,
          observedAt: product.observedAt,
          freshnessState: product.freshnessState,
        }
      : null,
    metrics: product
      ? {
          estimatedDemand: product.salesEstimates[0]
            ? {
                low: product.salesEstimates[0].monthlyUnitsLow.toString(),
                high: product.salesEstimates[0].monthlyUnitsHigh.toString(),
                source: product.salesEstimates[0].source,
                observedAt: product.salesEstimates[0].observedAt,
              }
            : null,
          opportunityScore:
            product.opportunityAssessments[0]?.score?.toString() ?? null,
          complianceRisk: product.complianceRiskAssessments[0]?.results ?? null,
          priceHistory: null,
          reviews: null,
          competition: null,
          profitabilityAssumptions: null,
          alerts: [],
          keywordLinks: [],
        }
      : null,
    availability: product
      ? "BACKEND_RECORD_AVAILABLE"
      : "TARGET_SENT_NO_BACKEND_RECORD",
  });
}
