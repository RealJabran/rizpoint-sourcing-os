import { NextRequest, NextResponse } from "next/server";
import {
  addShortlistNote,
  ensurePhaseZeroOrganization,
} from "@rizpoint/database";
import { requirePrivateAccess } from "@/src/private-access";
import { noteSchema } from "@/src/phase-six/contracts";
export const runtime = "nodejs";
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ shortlistId: string; itemId: string }> },
) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const parsed = noteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "INVALID_NOTE" }, { status: 400 });
  const org = await ensurePhaseZeroOrganization();
  const route = await params;
  const note = await addShortlistNote({
    organizationId: org.id,
    shortlistId: route.shortlistId,
    itemId: route.itemId,
    body: parsed.data.body,
    idempotencyKey: parsed.data.idempotencyKey,
    ...(parsed.data.authorReference !== undefined
      ? { authorReference: parsed.data.authorReference }
      : {}),
  });
  return note
    ? NextResponse.json(note, { status: 201 })
    : NextResponse.json({ error: "SHORTLIST_ITEM_NOT_FOUND" }, { status: 404 });
}
