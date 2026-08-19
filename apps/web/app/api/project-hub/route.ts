import { NextRequest, NextResponse } from "next/server";
import {
  compareProjectNiches,
  compareProjectProducts,
  createDecisionMemo,
  createProjectAssumption,
  createProjectEvidence,
  ensurePhaseZeroOrganization,
  getProjectHub,
} from "@rizpoint/database";
import { requirePrivateAccess } from "@/src/private-access";

export const runtime = "nodejs";

function text(body: Record<string, unknown>, key: string) {
  return typeof body[key] === "string" ? body[key] : "";
}
function strings(value: unknown, maximum = 100) {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .slice(0, maximum)
    : [];
}
function sections(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => typeof item === "string")
      .slice(0, 20),
  ) as Record<string, string>;
}

export async function GET(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const organization = await ensurePhaseZeroOrganization();
  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId)
    return NextResponse.json({ error: "PROJECT_ID_REQUIRED" }, { status: 400 });
  try {
    const type = request.nextUrl.searchParams.get("compare");
    const ids = (request.nextUrl.searchParams.get("ids") ?? "")
      .split(",")
      .filter(Boolean);
    if (type === "products")
      return NextResponse.json(
        await compareProjectProducts({
          organizationId: organization.id,
          projectId,
          ids,
        }),
      );
    if (type === "niches")
      return NextResponse.json(
        await compareProjectNiches({
          organizationId: organization.id,
          projectId,
          ids,
        }),
      );
    return NextResponse.json(
      await getProjectHub({ organizationId: organization.id, projectId }),
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "PROJECT_HUB_UNAVAILABLE",
      },
      { status: 400 },
    );
  }
}

export async function POST(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const organization = await ensurePhaseZeroOrganization();
  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body)
    return NextResponse.json(
      { error: "INVALID_PROJECT_HUB_REQUEST" },
      { status: 400 },
    );
  const projectId = text(body, "projectId");
  try {
    const action = text(body, "action");
    if (action === "evidence")
      return NextResponse.json(
        await createProjectEvidence({
          organizationId: organization.id,
          projectId,
          label: text(body, "label"),
          evidenceType: text(body, "evidenceType"),
          sourceReference: text(body, "sourceReference"),
          sourceDescription: text(body, "sourceDescription"),
          ...(text(body, "observedAt")
            ? { observedAt: text(body, "observedAt") }
            : {}),
        }),
        { status: 201 },
      );
    if (action === "assumption")
      return NextResponse.json(
        await createProjectAssumption({
          organizationId: organization.id,
          projectId,
          label: text(body, "label"),
          value: text(body, "value"),
          sourceReference: text(body, "sourceReference"),
          ...(text(body, "assumedAt")
            ? { assumedAt: text(body, "assumedAt") }
            : {}),
        }),
        { status: 201 },
      );
    if (action === "memo") {
      const outcome = text(body, "outcome");
      if (!["GO", "NO_GO", "HOLD"].includes(outcome))
        throw new Error("DECISION_MEMO_OUTCOME_INVALID");
      return NextResponse.json(
        await createDecisionMemo({
          organizationId: organization.id,
          projectId,
          title: text(body, "title"),
          thesis: text(body, "thesis"),
          outcome: outcome as "GO" | "NO_GO" | "HOLD",
          decisionOwner: text(body, "decisionOwner"),
          ...(text(body, "decidedAt")
            ? { decidedAt: text(body, "decidedAt") }
            : {}),
          sections: sections(body.sections),
          evidenceReferenceIds: strings(body.evidenceReferenceIds),
        }),
        { status: 201 },
      );
    }
    throw new Error("PROJECT_HUB_ACTION_INVALID");
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "PROJECT_HUB_WRITE_FAILED",
      },
      { status: 400 },
    );
  }
}
