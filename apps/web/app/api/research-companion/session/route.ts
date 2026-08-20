import { NextRequest, NextResponse } from "next/server";
import { ensurePhaseZeroOrganization } from "@rizpoint/database";
import { requirePrivateAccess } from "@/src/private-access";
import { createResearchCompanionSession } from "@/src/research-companion-session";
import { enforceApiRateLimit } from "@/src/api-rate-limit";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  try {
    const organization = await ensurePhaseZeroOrganization();
    const limited = await enforceApiRateLimit({
      request,
      organizationId: organization.id,
      scope: "research.companion-session",
      limit: 20,
      windowSeconds: 300,
    });
    if (limited) return limited;
    return NextResponse.json(createResearchCompanionSession(organization.id));
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
