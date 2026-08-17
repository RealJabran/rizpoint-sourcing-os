import { NextRequest, NextResponse } from "next/server";
import {
  createLaunchPlan,
  ensurePhaseZeroOrganization,
  getLaunchPlan,
  LAUNCH_STAGES,
  updateLaunchStage,
} from "@rizpoint/database";
import { requirePrivateAccess } from "@/src/private-access";

export const runtime = "nodejs";
const lines = (value: unknown) =>
  Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .slice(0, 100)
    : [];

export async function GET(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const planId = request.nextUrl.searchParams.get("planId");
  if (!planId)
    return NextResponse.json(
      { error: "LAUNCH_PLAN_ID_REQUIRED" },
      { status: 400 },
    );
  const organization = await ensurePhaseZeroOrganization();
  try {
    return NextResponse.json(
      await getLaunchPlan({
        organizationId: organization.id,
        launchPlanId: planId,
      }),
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "LAUNCH_PLAN_UNAVAILABLE",
      },
      { status: 400 },
    );
  }
}

export async function POST(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const body = (await request.json()) as Record<string, unknown>;
  const organization = await ensurePhaseZeroOrganization();
  try {
    if (body.action === "CREATE") {
      if (typeof body.projectId !== "string")
        throw new Error("PROJECT_ID_REQUIRED");
      return NextResponse.json(
        await createLaunchPlan({
          organizationId: organization.id,
          projectId: body.projectId,
          name: typeof body.name === "string" ? body.name : "",
          assumptions: lines(body.assumptions),
          risks: lines(body.risks),
        }),
      );
    }
    if (body.action === "UPDATE_STAGE") {
      if (
        typeof body.planId !== "string" ||
        typeof body.stage !== "string" ||
        typeof body.status !== "string" ||
        !LAUNCH_STAGES.includes(body.stage as (typeof LAUNCH_STAGES)[number])
      )
        throw new Error("LAUNCH_STAGE_INPUT_INVALID");
      if (
        !["NOT_STARTED", "IN_PROGRESS", "BLOCKED", "COMPLETE"].includes(
          body.status,
        )
      )
        throw new Error("LAUNCH_STAGE_STATUS_INVALID");
      const dueDate =
        typeof body.dueDate === "string" && body.dueDate
          ? new Date(body.dueDate)
          : undefined;
      if (dueDate && Number.isNaN(dueDate.getTime()))
        throw new Error("LAUNCH_DUE_DATE_INVALID");
      return NextResponse.json(
        await updateLaunchStage({
          organizationId: organization.id,
          launchPlanId: body.planId,
          stage: body.stage as (typeof LAUNCH_STAGES)[number],
          status: body.status as "NOT_STARTED",
          ...(typeof body.ownerLabel === "string"
            ? { ownerLabel: body.ownerLabel }
            : {}),
          ...(dueDate ? { dueDate } : {}),
          ...(typeof body.budget === "string" && body.budget
            ? { budget: body.budget }
            : {}),
          ...(typeof body.budgetCurrency === "string"
            ? { budgetCurrency: body.budgetCurrency }
            : {}),
          targetKpis: lines(body.targetKpis),
          assumptions: lines(body.assumptions),
          risks: lines(body.risks),
          evidenceRefs: lines(body.evidenceRefs),
        }),
      );
    }
    throw new Error("LAUNCH_PLANNER_ACTION_INVALID");
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "LAUNCH_PLANNER_FAILED",
      },
      { status: 400 },
    );
  }
}
