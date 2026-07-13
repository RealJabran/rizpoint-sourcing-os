import { NextRequest, NextResponse } from "next/server";
import {
  applyAnalysisOverride,
  ensurePhaseZeroOrganization,
  getAnalysisResult,
} from "@rizpoint/database";
import { phaseZeroDemoEnabled } from "@/src/phase-zero";
import { overrideSchema } from "@/src/analysis/contracts";

export const runtime = "nodejs";

export async function GET(
  _: NextRequest,
  { params }: { params: Promise<{ resultId: string }> },
) {
  if (!phaseZeroDemoEnabled())
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const organization = await ensurePhaseZeroOrganization();
  const result = await getAnalysisResult(
    organization.id,
    (await params).resultId,
  );
  return result
    ? NextResponse.json(result)
    : NextResponse.json({ error: "RESULT_NOT_FOUND" }, { status: 404 });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ resultId: string }> },
) {
  if (!phaseZeroDemoEnabled())
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await request.json().catch(() => null);
  const parsed = overrideSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json({ error: "INVALID_OVERRIDE" }, { status: 400 });
  try {
    const organization = await ensurePhaseZeroOrganization();
    const output = await applyAnalysisOverride({
      organizationId: organization.id,
      resultId: (await params).resultId,
      ...parsed.data,
    });
    return output
      ? NextResponse.json(output, { status: output.duplicate ? 200 : 202 })
      : NextResponse.json({ error: "RESULT_NOT_FOUND" }, { status: 404 });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "OVERRIDE_REVISION_CONFLICT"
    )
      return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
