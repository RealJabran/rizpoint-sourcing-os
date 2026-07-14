import { NextRequest, NextResponse } from "next/server";
import {
  addShortlistItems,
  ensurePhaseZeroOrganization,
  transitionShortlistItems,
} from "@rizpoint/database";
import { requirePrivateAccess } from "@/src/private-access";
import {
  addShortlistItemsSchema,
  transitionShortlistItemsSchema,
} from "@/src/phase-six/contracts";
export const runtime = "nodejs";
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ shortlistId: string }> },
) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const parsed = addShortlistItemsSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: "INVALID_SHORTLIST_ITEMS" },
      { status: 400 },
    );
  try {
    const org = await ensurePhaseZeroOrganization();
    const result = await addShortlistItems({
      organizationId: org.id,
      shortlistId: (await params).shortlistId,
      ...parsed.data,
    });
    return result
      ? NextResponse.json(result, { status: 201 })
      : NextResponse.json({ error: "SHORTLIST_NOT_FOUND" }, { status: 404 });
  } catch {
    return NextResponse.json({ error: "RESULT_NOT_FOUND" }, { status: 404 });
  }
}
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ shortlistId: string }> },
) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const parsed = transitionShortlistItemsSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: "INVALID_SHORTLIST_TRANSITION" },
      { status: 400 },
    );
  try {
    const org = await ensurePhaseZeroOrganization();
    return NextResponse.json(
      await transitionShortlistItems({
        organizationId: org.id,
        shortlistId: (await params).shortlistId,
        itemIds: parsed.data.itemIds,
        status: parsed.data.status,
        idempotencyKey: parsed.data.idempotencyKey,
        ...(parsed.data.ownerReference !== undefined
          ? { ownerReference: parsed.data.ownerReference }
          : {}),
        ...(parsed.data.expectedRevision !== undefined
          ? { expectedRevision: parsed.data.expectedRevision }
          : {}),
      }),
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "SHORTLIST_UPDATE_FAILED",
      },
      { status: 409 },
    );
  }
}
