import { NextRequest, NextResponse } from "next/server";
import { ensurePhaseZeroOrganization, queueEnrichment } from "@rizpoint/database";
import { z } from "zod";
import { phaseZeroDemoEnabled } from "@/src/phase-zero";

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
  if (!phaseZeroDemoEnabled())
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = refreshSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "INVALID_REFRESH_REQUEST" }, { status: 400 });
  const organization = await ensurePhaseZeroOrganization();
  const run = await queueEnrichment(
    organization.id,
    (await params).scanId,
    parsed.data.idempotencyKey,
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
