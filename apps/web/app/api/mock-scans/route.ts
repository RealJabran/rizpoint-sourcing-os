import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  createMockScanJob,
  ensurePhaseZeroOrganization,
} from "@rizpoint/database";
import { phaseZeroDemoEnabled } from "@/src/phase-zero";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!phaseZeroDemoEnabled())
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const organization = await ensurePhaseZeroOrganization();
  const idempotencyKey = request.headers.get("idempotency-key") ?? randomUUID();
  const job = await createMockScanJob(organization.id, idempotencyKey);
  return NextResponse.json(job, { status: 202 });
}
