import { NextRequest, NextResponse } from "next/server";
import {
  ensurePhaseZeroOrganization,
  reverseAsinKeywordGap,
} from "@rizpoint/database";
import { requirePrivateAccess } from "@/src/private-access";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as {
    asins?: unknown;
    mineAsin?: unknown;
  } | null;
  const asins = Array.isArray(body?.asins)
    ? body.asins
        .filter(
          (item): item is string =>
            typeof item === "string" && /^B[A-Z0-9]{9}$/.test(item),
        )
        .slice(0, 10)
    : [];
  if (!asins.length)
    return NextResponse.json({ error: "INVALID_ASINS" }, { status: 400 });
  const org = await ensurePhaseZeroOrganization();
  return NextResponse.json(
    await reverseAsinKeywordGap({
      organizationId: org.id,
      asins,
      ...(typeof body?.mineAsin === "string"
        ? { mineAsin: body.mineAsin }
        : {}),
    }),
  );
}
