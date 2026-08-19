import { NextRequest, NextResponse } from "next/server";
import { ensurePhaseZeroOrganization } from "@rizpoint/database";
import { requirePrivateAccess } from "@/src/private-access";
import { createResearchCompanionSession } from "@/src/research-companion-session";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  try {
    return NextResponse.json(
      createResearchCompanionSession((await ensurePhaseZeroOrganization()).id),
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "RESEARCH_COMPANION_SESSION_FAILED",
      },
      { status: 503 },
    );
  }
}
