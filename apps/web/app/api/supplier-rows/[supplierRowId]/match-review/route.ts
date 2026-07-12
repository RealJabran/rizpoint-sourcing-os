import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  ensurePhaseZeroOrganization,
  reviewMatchDecision,
} from "@rizpoint/database";
import { phaseZeroDemoEnabled } from "@/src/phase-zero";

const inputSchema = z.object({
  selectedCandidateId: z.string().min(1).nullable(),
  status: z.enum(["USER_ACCEPTED", "USER_REJECTED"]),
});

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ supplierRowId: string }> },
) {
  if (!phaseZeroDemoEnabled())
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = inputSchema.safeParse(await request.json());
  if (!parsed.success)
    return NextResponse.json({ error: "INVALID_REVIEW" }, { status: 400 });
  const organization = await ensurePhaseZeroOrganization();
  const decision = await reviewMatchDecision({
    organizationId: organization.id,
    supplierRowId: (await params).supplierRowId,
    ...parsed.data,
  });
  return decision
    ? NextResponse.json(decision)
    : NextResponse.json({ error: "Not found" }, { status: 404 });
}
