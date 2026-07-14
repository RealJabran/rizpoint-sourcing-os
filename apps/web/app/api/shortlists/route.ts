import { NextRequest, NextResponse } from "next/server";
import {
  createShortlist,
  ensurePhaseZeroOrganization,
  listShortlists,
} from "@rizpoint/database";
import { requirePrivateAccess } from "@/src/private-access";
import { createShortlistSchema } from "@/src/phase-six/contracts";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const org = await ensurePhaseZeroOrganization();
  return NextResponse.json(await listShortlists(org.id));
}
export async function POST(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
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
