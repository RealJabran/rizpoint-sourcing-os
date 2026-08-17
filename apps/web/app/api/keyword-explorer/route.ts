import { NextRequest, NextResponse } from "next/server";
import {
  ensurePhaseZeroOrganization,
  listKeywordExplorer,
} from "@rizpoint/database";
import { requirePrivateAccess } from "@/src/private-access";
import { keywordExplorerSchema } from "@/src/keyword-explorer/contracts";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const parsed = keywordExplorerSchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: "INVALID_KEYWORD_QUERY" },
      { status: 400 },
    );
  const org = await ensurePhaseZeroOrganization();
  return NextResponse.json(
    await listKeywordExplorer({ organizationId: org.id, ...parsed.data }),
  );
}
