import { Prisma } from "../generated/prisma/client.js";
import { db } from "../client.js";
import {
  canAdvanceLaunchStage,
  LAUNCH_STAGES,
  launchDependencies,
  type LaunchStage,
  type LaunchStageState,
} from "../launch-planner-policy.js";

const decimal = /^\d+(?:\.\d{1,4})?$/;
function stringArray(value: Prisma.JsonValue): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export async function createLaunchPlan(input: {
  organizationId: string;
  projectId: string;
  name: string;
  assumptions?: string[] | undefined;
  risks?: string[] | undefined;
}) {
  const project = await db.researchProject.findFirst({
    where: {
      id: input.projectId,
      organizationId: input.organizationId,
      status: "ACTIVE",
    },
    include: {
      items: { include: { keyword: true, catalogProduct: true } },
      assessments: { orderBy: { calculatedAt: "desc" }, take: 10 },
      productWatches: { where: { status: "ACTIVE" } },
      notes: { orderBy: { updatedAt: "desc" }, take: 20 },
    },
  });
  if (!project) throw new Error("ACTIVE_RESEARCH_PROJECT_REQUIRED");
  const pursue = project.assessments.find(
    (assessment) =>
      assessment.recommendation === "PURSUE" &&
      assessment.status === "COMPLETE",
  );
  const evidenceSnapshot = {
    projectId: project.id,
    projectUpdatedAt: project.updatedAt.toISOString(),
    projectItemIds: project.items.map((item) => item.id),
    assessment: pursue
      ? {
          id: pursue.id,
          calculationVersion: pursue.calculationVersion,
          calculatedAt: pursue.calculatedAt.toISOString(),
          inputReferences: pursue.inputObservationReferences,
        }
      : null,
    researchNoteIds: project.notes.map((note) => note.id),
    validation: pursue
      ? "PURSUE_ASSESSMENT"
      : "NICHE_APPROVAL_EVIDENCE_MISSING",
  };
  const researchOutputs = {
    targetKeywords: project.items.flatMap((item) =>
      item.keyword
        ? [{ id: item.keyword.id, phrase: item.keyword.phrase }]
        : [],
    ),
    competitorSet: project.items.flatMap((item) =>
      item.catalogProduct
        ? [
            {
              id: item.catalogProduct.id,
              asin: item.catalogProduct.asin,
              title: item.catalogProduct.title,
            },
          ]
        : [],
    ),
    targetPriceBand: null,
    breakEvenPpcAssumptions: null,
    minimumAcceptableMargin: null,
    monitoringWatchlist: project.productWatches.map((watch) => ({
      id: watch.id,
      catalogProductId: watch.catalogProductId,
      marketplaceId: watch.marketplaceId,
    })),
    unavailable: [
      "Target price band requires sourced market pricing",
      "Break-even PPC requires explicit advertising assumptions",
      "Minimum margin requires a deterministic private-label cost scenario",
    ],
  };
  return db.launchPlan.create({
    data: {
      organizationId: input.organizationId,
      projectId: project.id,
      name: input.name.trim() || `${project.name} launch plan`,
      evidenceSnapshot: evidenceSnapshot as Prisma.InputJsonValue,
      researchOutputs: researchOutputs as Prisma.InputJsonValue,
      assumptions: input.assumptions ?? [],
      risks: input.risks ?? [],
      stages: {
        create: LAUNCH_STAGES.map((stage) => ({
          organizationId: input.organizationId,
          stage,
          status:
            stage === "NICHE_APPROVED" && !pursue ? "BLOCKED" : "NOT_STARTED",
          dependencies: launchDependencies[stage],
          targetKpis: [],
          assumptions: [],
          risks: [],
          evidenceRefs: stage === "NICHE_APPROVED" ? [evidenceSnapshot] : [],
        })),
      },
      changes: {
        create: {
          organizationId: input.organizationId,
          action: "PLAN_CREATED",
          details: evidenceSnapshot as Prisma.InputJsonValue,
        },
      },
    },
    include: { stages: { orderBy: { createdAt: "asc" } }, changes: true },
  });
}

export async function updateLaunchStage(input: {
  organizationId: string;
  launchPlanId: string;
  stage: LaunchStage;
  status: LaunchStageState;
  ownerLabel?: string | undefined;
  dueDate?: Date | undefined;
  budget?: string | undefined;
  budgetCurrency?: string | undefined;
  targetKpis?: string[] | undefined;
  assumptions?: string[] | undefined;
  risks?: string[] | undefined;
  evidenceRefs?: string[] | undefined;
}) {
  if (input.budget && !decimal.test(input.budget))
    throw new Error("LAUNCH_BUDGET_INVALID");
  return db.$transaction(async (transaction) => {
    const plan = await transaction.launchPlan.findFirst({
      where: { id: input.launchPlanId, organizationId: input.organizationId },
      include: { stages: true },
    });
    if (!plan) throw new Error("LAUNCH_PLAN_NOT_FOUND");
    const stage = plan.stages.find((item) => item.stage === input.stage);
    if (!stage) throw new Error("LAUNCH_STAGE_NOT_FOUND");
    const stageStates = Object.fromEntries(
      plan.stages.map((item) => [item.stage, item.status]),
    ) as Partial<Record<LaunchStage, LaunchStageState>>;
    if (
      !canAdvanceLaunchStage({
        target: input.stage,
        status: input.status,
        stageStates,
      })
    )
      throw new Error("LAUNCH_STAGE_DEPENDENCIES_INCOMPLETE");
    const completionEvidence =
      input.evidenceRefs ?? stringArray(stage.evidenceRefs);
    if (input.status === "COMPLETE" && !completionEvidence.length)
      throw new Error("LAUNCH_STAGE_EVIDENCE_REQUIRED");
    const planEvidence = plan.evidenceSnapshot as { validation?: unknown };
    if (
      input.stage === "NICHE_APPROVED" &&
      input.status === "COMPLETE" &&
      planEvidence.validation !== "PURSUE_ASSESSMENT" &&
      !input.evidenceRefs?.length
    )
      throw new Error("NICHE_APPROVAL_EVIDENCE_REQUIRED");
    const updated = await transaction.launchPlanStage.update({
      where: { id: stage.id },
      data: {
        status: input.status,
        ...(input.ownerLabel !== undefined
          ? { ownerLabel: input.ownerLabel.trim() || null }
          : {}),
        ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
        ...(input.budget !== undefined ? { budget: input.budget } : {}),
        ...(input.budgetCurrency !== undefined
          ? { budgetCurrency: input.budgetCurrency }
          : {}),
        ...(input.targetKpis ? { targetKpis: input.targetKpis } : {}),
        ...(input.assumptions ? { assumptions: input.assumptions } : {}),
        ...(input.risks ? { risks: input.risks } : {}),
        ...(input.evidenceRefs ? { evidenceRefs: input.evidenceRefs } : {}),
      },
    });
    await transaction.launchPlanChange.create({
      data: {
        organizationId: input.organizationId,
        launchPlanId: plan.id,
        stage: input.stage,
        action: "STAGE_UPDATED",
        details: {
          status: input.status,
          ownerLabel: input.ownerLabel ?? stage.ownerLabel,
          dueDate:
            input.dueDate?.toISOString() ??
            stage.dueDate?.toISOString() ??
            null,
          budget: input.budget ?? stage.budget?.toString() ?? null,
          evidenceRefs: input.evidenceRefs ?? stringArray(stage.evidenceRefs),
        },
      },
    });
    return updated;
  });
}

export async function getLaunchPlan(input: {
  organizationId: string;
  launchPlanId: string;
}) {
  const plan = await db.launchPlan.findFirst({
    where: { id: input.launchPlanId, organizationId: input.organizationId },
    include: {
      stages: { orderBy: { createdAt: "asc" } },
      changes: { orderBy: { createdAt: "desc" }, take: 100 },
    },
  });
  if (!plan) throw new Error("LAUNCH_PLAN_NOT_FOUND");
  return plan;
}
