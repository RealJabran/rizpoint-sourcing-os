import { NextRequest, NextResponse } from "next/server";
import {
  getProductResearchRun,
  listRecentProductResearchRuns,
  queueProductResearchRun,
} from "@rizpoint/database";
import { requirePrivateAccess } from "@/src/private-access";
import { organizationForRequest } from "@/src/request-organization";
import {
  normalizeProductLookup,
  productResearchRequestSchema,
} from "@/src/product-research/contracts";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const organization = await organizationForRequest(request);
  const runId = request.nextUrl.searchParams.get("runId");
  if (!runId)
    return NextResponse.json({
      runs: await listRecentProductResearchRuns({
        organizationId: organization.id,
        ...(request.nextUrl.searchParams.get("marketplaceId")
          ? {
              marketplaceId: request.nextUrl.searchParams.get("marketplaceId")!,
            }
          : {}),
      }),
    });
  const run = await getProductResearchRun({
    organizationId: organization.id,
    runId,
    offset: Number(request.nextUrl.searchParams.get("offset") ?? 0),
    limit: Number(request.nextUrl.searchParams.get("limit") ?? 20),
  });
  return run
    ? NextResponse.json(run)
    : NextResponse.json(
        { error: "PRODUCT_RESEARCH_RUN_NOT_FOUND" },
        { status: 404 },
      );
}

export async function POST(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const parsed = productResearchRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json(
      {
        error: "INVALID_PRODUCT_RESEARCH_REQUEST",
        detail: parsed.error.issues[0]?.message,
      },
      { status: 400 },
    );
  const organization = await organizationForRequest(request);
  const lookup =
    parsed.data.kind === "PRODUCT_LOOKUP"
      ? normalizeProductLookup(parsed.data.query)
      : { queryType: "KEYWORD" as const, queryText: parsed.data.query };
  if (!lookup)
    return NextResponse.json(
      { error: "PRODUCT_IDENTIFIER_INVALID" },
      { status: 400 },
    );
  try {
    const run = await queueProductResearchRun({
      organizationId: organization.id,
      marketplaceId: parsed.data.marketplaceId,
      kind: parsed.data.kind,
      queryType: lookup.queryType,
      queryText: lookup.queryText,
      ...(parsed.data.requestedLimit === undefined
        ? {}
        : { requestedLimit: parsed.data.requestedLimit }),
      ...(parsed.data.salePrice ? { salePrice: parsed.data.salePrice } : {}),
      ...(parsed.data.currency ? { currency: parsed.data.currency } : {}),
      ...(parsed.data.forceRefresh === undefined
        ? {}
        : { forceRefresh: parsed.data.forceRefresh }),
      idempotencyKey: parsed.data.idempotencyKey,
    });
    return NextResponse.json(
      { id: run.id, status: run.status, duplicate: run.duplicate },
      { status: run.duplicate ? 200 : 202 },
    );
  } catch (error) {
    const code =
      error instanceof Error ? error.message : "PRODUCT_RESEARCH_FAILED";
    const status = code.includes("NOT_CONNECTED") ? 412 : 409;
    return NextResponse.json({ error: code }, { status });
  }
}
