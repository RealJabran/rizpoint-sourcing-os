import { NextRequest, NextResponse } from "next/server";
import {
  ensurePhaseZeroOrganization,
  queueEnrichment,
} from "@rizpoint/database";
import { phaseZeroDemoEnabled } from "@/src/phase-zero";
import { z } from "zod";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ scanId: string }> },
) {
  if (!phaseZeroDemoEnabled())
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const parsed = z
    .object({ idempotencyKey: z.string().uuid().optional() })
    .safeParse(body);
  if (!parsed.success)
    return NextResponse.json({ error: "INVALID_REFRESH_REQUEST" }, { status: 400 });
  const organization = await ensurePhaseZeroOrganization();
  const run = await queueEnrichment(
    organization.id,
    (await params).scanId,
    parsed.data.idempotencyKey,
  );
  return run
    ? NextResponse.json(
        { id: run.id, status: run.status, duplicate: run.duplicate },
        { status: 202 },
      )
    : NextResponse.json(
        { error: "NO_ACCEPTED_MATCHES_OR_SCAN_NOT_READY" },
        { status: 409 },
      );
}
