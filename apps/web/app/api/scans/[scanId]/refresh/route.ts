import { NextRequest, NextResponse } from "next/server";
import { queueEnrichment } from "@rizpoint/database";
import { z } from "zod";
import { requirePrivateAccess } from "@/src/private-access";
import { organizationForRequest } from "@/src/request-organization";

export const runtime = "nodejs";

const refreshSchema = z.object({ idempotencyKey: z.string().uuid() });

/**
 * A named refresh endpoint keeps the research workspace intent clear while
 * using the same checkpointed enrichment run as the existing scan pipeline.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ scanId: string }> },
) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const parsed = refreshSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: "INVALID_REFRESH_REQUEST" },
      { status: 400 },
    );
  const organization = await organizationForRequest(request);
  const run = await queueEnrichment(
    organization.id,
    (await params).scanId,
    parsed.data.idempotencyKey,
    { forceRefresh: true },
  );
  if (!run)
    return NextResponse.json(
      { error: "SCAN_NOT_READY_FOR_REFRESH" },
      { status: 409 },
    );
  return NextResponse.json(
    { id: run.id, status: run.status, duplicate: run.duplicate },
    { status: 202 },
  );
}
