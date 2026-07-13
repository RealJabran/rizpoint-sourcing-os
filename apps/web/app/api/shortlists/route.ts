import { NextRequest, NextResponse } from "next/server";
import {
  createShortlist,
  ensurePhaseZeroOrganization,
  listShortlists,
} from "@rizpoint/database";
import { phaseZeroDemoEnabled } from "@/src/phase-zero";
import { createShortlistSchema } from "@/src/phase-six/contracts";
export const runtime = "nodejs";
export async function GET() {
  if (!phaseZeroDemoEnabled())
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const org = await ensurePhaseZeroOrganization();
  return NextResponse.json(await listShortlists(org.id));
}
export async function POST(request: NextRequest) {
  if (!phaseZeroDemoEnabled())
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = createShortlistSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json({ error: "INVALID_SHORTLIST" }, { status: 400 });
  const org = await ensurePhaseZeroOrganization();
  const result = await createShortlist({
    organizationId: org.id,
    name: parsed.data.name,
    idempotencyKey: parsed.data.idempotencyKey,
    ...(parsed.data.description !== undefined
      ? { description: parsed.data.description }
      : {}),
  });
  return NextResponse.json(result, { status: 201 });
}
