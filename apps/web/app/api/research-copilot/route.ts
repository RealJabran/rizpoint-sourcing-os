import { NextRequest, NextResponse } from "next/server";
import {
  ensurePhaseZeroOrganization,
  retrieveCopilotAnswer,
  sanitizeCopilotQuestion,
} from "@rizpoint/database";
import { requirePrivateAccess } from "@/src/private-access";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const question =
    typeof body?.question === "string"
      ? sanitizeCopilotQuestion(body.question)
      : "";
  if (!question)
    return NextResponse.json(
      { error: "COPILOT_QUESTION_REQUIRED" },
      { status: 400 },
    );
  const projectId =
    typeof body?.projectId === "string" ? body.projectId : undefined;
  try {
    return NextResponse.json({
      providerState: "NOT_CONFIGURED",
      answer: await retrieveCopilotAnswer({
        organizationId: (await ensurePhaseZeroOrganization()).id,
        question,
        ...(projectId ? { projectId } : {}),
      }),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "COPILOT_RETRIEVAL_FAILED",
      },
      { status: 400 },
    );
  }
}
