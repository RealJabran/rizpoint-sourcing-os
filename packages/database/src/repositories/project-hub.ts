import { Prisma } from "../generated/prisma/client.js";
import { db } from "../client.js";

type ProductCandidate = {
  id: string;
  label: string;
  asin: string | null;
  brand: string | null;
  opportunityScore: string | null;
  unitsLow: string | null;
  unitsHigh: string | null;
  confidencePercent: string | null;
  complianceRisk: string | null;
  observedAt: string | null;
};

function decimal(value: { toString(): string } | null | undefined) {
  return value == null ? null : value.toString();
}
function limitIds(ids: readonly string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) throw new Error("COMPARISON_IDS_REQUIRED");
  if (unique.length > 10) throw new Error("COMPARISON_LIMIT_EXCEEDED");
  return unique;
}
function numeric(value: string | null) {
  return value === null ? null : Number(value);
}

/** Deterministic explanation only: it never fabricates an overall score. */
export function explainProductComparison(
  left: ProductCandidate,
  right: ProductCandidate,
): string[] {
  const reasons: string[] = [];
  const checks: Array<[keyof ProductCandidate, string, "higher" | "lower"]> = [
    ["opportunityScore", "opportunity score", "higher"],
    ["unitsLow", "estimated monthly units (low range)", "higher"],
    ["confidencePercent", "estimate confidence", "higher"],
  ];
  for (const [field, label, direction] of checks) {
    const a = numeric(left[field] as string | null);
    const b = numeric(right[field] as string | null);
    if (a === null || b === null || a === b) continue;
    const winner = (direction === "higher" ? a > b : a < b) ? left : right;
    reasons.push(`${winner.label} is stronger on ${label} (${a} vs ${b}).`);
  }
  if (left.complianceRisk !== right.complianceRisk) {
    const order = ["LOW", "REVIEW", "UNKNOWN", "HIGH"];
    const a = order.indexOf(left.complianceRisk ?? "UNKNOWN");
    const b = order.indexOf(right.complianceRisk ?? "UNKNOWN");
    if (a !== b)
      reasons.push(
        `${a < b ? left.label : right.label} has the lower recorded compliance risk.`,
      );
  }
  return reasons.length
    ? reasons
    : ["No supported metric distinguishes these candidates yet."];
}

function highestRisk(results: unknown): string | null {
  if (!Array.isArray(results)) return null;
  const values = results
    .filter(
      (item): item is Record<string, unknown> =>
        !!item && typeof item === "object",
    )
    .map((item) => item.risk)
    .filter((risk): risk is string => typeof risk === "string");
  return (
    ["HIGH", "REVIEW", "UNKNOWN", "LOW"].find((risk) =>
      values.includes(risk),
    ) ?? null
  );
}

export async function getProjectHub(input: {
  organizationId: string;
  projectId: string;
}) {
  const project = await db.researchProject.findFirst({
    where: { id: input.projectId, organizationId: input.organizationId },
    include: {
      items: {
        orderBy: { updatedAt: "desc" },
        take: 100,
        include: {
          catalogProduct: {
            include: {
              productResearchItems: {
                where: { organizationId: input.organizationId },
                orderBy: { createdAt: "desc" },
                take: 1,
                select: {
                  observedAt: true,
                  freshnessState: true,
                  completeness: true,
                  source: true,
                  run: {
                    select: {
                      id: true,
                      status: true,
                      completedAt: true,
                      createdAt: true,
                    },
                  },
                },
              },
            },
          },
          marketDefinition: true,
          keyword: true,
        },
      },
      projectTags: { include: { tag: true } },
      notes: { orderBy: { updatedAt: "desc" }, take: 30 },
      evidenceReferences: { orderBy: { createdAt: "desc" }, take: 50 },
      assumptions: { orderBy: { assumedAt: "desc" }, take: 50 },
      decisionMemos: {
        orderBy: { decidedAt: "desc" },
        take: 30,
        include: { sources: { orderBy: { createdAt: "asc" } } },
      },
      productFacts: { take: 100 },
      listingDrafts: { orderBy: { updatedAt: "desc" }, take: 20 },
      launchPlans: { orderBy: { updatedAt: "desc" }, take: 20 },
      privateLabelQuoteScenarios: { orderBy: { updatedAt: "desc" }, take: 20 },
      productWatches: { take: 100 },
      complianceRiskAssessments: {
        orderBy: { calculatedAt: "desc" },
        take: 20,
      },
      portfolioOptimizationRuns: {
        orderBy: { calculatedAt: "desc" },
        take: 20,
      },
      assessments: { orderBy: { calculatedAt: "desc" }, take: 100 },
    },
  });
  if (!project) throw new Error("RESEARCH_PROJECT_NOT_FOUND");
  return project;
}

export async function createProjectNote(input: {
  organizationId: string;
  projectId: string;
  body: string;
}) {
  if (!input.body.trim()) throw new Error("PROJECT_NOTE_REQUIRED");
  const project = await db.researchProject.findFirst({
    where: { id: input.projectId, organizationId: input.organizationId },
    select: { id: true },
  });
  if (!project) throw new Error("RESEARCH_PROJECT_NOT_FOUND");
  return db.researchNote.create({
    data: {
      organizationId: input.organizationId,
      projectId: input.projectId,
      body: input.body.trim(),
    },
  });
}

export async function createProjectEvidence(input: {
  organizationId: string;
  projectId: string;
  label: string;
  evidenceType: string;
  sourceReference: string;
  sourceDescription?: string;
  observedAt?: string;
}) {
  if (
    !input.label.trim() ||
    !input.evidenceType.trim() ||
    !input.sourceReference.trim()
  )
    throw new Error("EVIDENCE_REFERENCE_FIELDS_REQUIRED");
  const project = await db.researchProject.findFirst({
    where: { id: input.projectId, organizationId: input.organizationId },
    select: { id: true },
  });
  if (!project) throw new Error("RESEARCH_PROJECT_NOT_FOUND");
  return db.projectEvidenceReference.create({
    data: {
      organizationId: input.organizationId,
      projectId: input.projectId,
      label: input.label.trim(),
      evidenceType: input.evidenceType.trim(),
      sourceReference: input.sourceReference.trim(),
      sourceDescription: input.sourceDescription?.trim() || null,
      observedAt: input.observedAt ? new Date(input.observedAt) : null,
    },
  });
}

export async function createProjectAssumption(input: {
  organizationId: string;
  projectId: string;
  label: string;
  value: string;
  sourceReference?: string;
  assumedAt?: string;
}) {
  if (!input.label.trim() || !input.value.trim())
    throw new Error("ASSUMPTION_FIELDS_REQUIRED");
  const project = await db.researchProject.findFirst({
    where: { id: input.projectId, organizationId: input.organizationId },
    select: { id: true },
  });
  if (!project) throw new Error("RESEARCH_PROJECT_NOT_FOUND");
  return db.projectAssumption.create({
    data: {
      organizationId: input.organizationId,
      projectId: input.projectId,
      label: input.label.trim(),
      value: input.value.trim(),
      sourceReference: input.sourceReference?.trim() || null,
      assumedAt: input.assumedAt ? new Date(input.assumedAt) : new Date(),
    },
  });
}

export async function createDecisionMemo(input: {
  organizationId: string;
  projectId: string;
  title: string;
  thesis: string;
  outcome: "GO" | "NO_GO" | "HOLD";
  decisionOwner: string;
  decidedAt?: string;
  sections: Record<string, string>;
  evidenceReferenceIds: string[];
}) {
  if (
    !input.title.trim() ||
    !input.thesis.trim() ||
    !input.decisionOwner.trim()
  )
    throw new Error("DECISION_MEMO_FIELDS_REQUIRED");
  const project = await getProjectHub({
    organizationId: input.organizationId,
    projectId: input.projectId,
  });
  const ids = [...new Set(input.evidenceReferenceIds)].slice(0, 100);
  const evidence = ids.length
    ? await db.projectEvidenceReference.findMany({
        where: {
          organizationId: input.organizationId,
          projectId: input.projectId,
          id: { in: ids },
        },
      })
    : [];
  if (evidence.length !== ids.length)
    throw new Error("DECISION_MEMO_EVIDENCE_NOT_IN_PROJECT");
  const sourceSnapshot = {
    project: {
      id: project.id,
      version: project.version,
      marketplaceId: project.marketplaceId,
    },
    evidenceIds: evidence.map((item) => item.id),
    assumptionIds: project.assumptions.map((item) => item.id),
    assessmentIds: project.assessments.map((item) => item.id),
    capturedAt: new Date().toISOString(),
  };
  return db.decisionMemo.create({
    data: {
      organizationId: input.organizationId,
      projectId: input.projectId,
      title: input.title.trim(),
      thesis: input.thesis.trim(),
      outcome: input.outcome,
      decisionOwner: input.decisionOwner.trim(),
      decidedAt: input.decidedAt ? new Date(input.decidedAt) : new Date(),
      sections: input.sections as Prisma.InputJsonValue,
      sourceSnapshot: sourceSnapshot as Prisma.InputJsonValue,
      sources: {
        create: evidence.map((item) => ({
          organizationId: input.organizationId,
          evidenceReferenceId: item.id,
          sourceType: "PROJECT_EVIDENCE",
          sourceId: item.id,
          snapshot: {
            label: item.label,
            type: item.evidenceType,
            reference: item.sourceReference,
            observedAt: item.observedAt?.toISOString() ?? null,
          } as Prisma.InputJsonValue,
        })),
      },
    },
    include: { sources: true },
  });
}

export async function compareProjectProducts(input: {
  organizationId: string;
  projectId: string;
  ids: readonly string[];
}) {
  const ids = limitIds(input.ids);
  const items = await db.researchProjectItem.findMany({
    where: {
      organizationId: input.organizationId,
      projectId: input.projectId,
      kind: "PRODUCT",
      catalogProductId: { in: ids },
    },
    include: {
      catalogProduct: {
        include: {
          salesEstimates: {
            where: { organizationId: input.organizationId },
            orderBy: { observedAt: "desc" },
            take: 1,
          },
          opportunityAssessments: {
            where: {
              organizationId: input.organizationId,
              projectId: input.projectId,
            },
            orderBy: { calculatedAt: "desc" },
            take: 1,
          },
          complianceRiskAssessments: {
            where: {
              organizationId: input.organizationId,
              projectId: input.projectId,
            },
            orderBy: { calculatedAt: "desc" },
            take: 1,
          },
        },
      },
    },
  });
  if (items.length !== ids.length)
    throw new Error("COMPARISON_PRODUCT_NOT_IN_PROJECT");
  const candidates: ProductCandidate[] = items.map((item) => {
    const product = item.catalogProduct!;
    const sales = product.salesEstimates[0];
    const assessment = product.opportunityAssessments[0];
    const compliance = product.complianceRiskAssessments[0];
    return {
      id: product.id,
      label: item.displayLabel ?? product.title,
      asin: product.asin,
      brand: product.brand,
      opportunityScore: decimal(assessment?.score),
      unitsLow: decimal(sales?.monthlyUnitsLow),
      unitsHigh: decimal(sales?.monthlyUnitsHigh),
      confidencePercent: decimal(sales?.confidencePercent),
      complianceRisk: highestRisk(compliance?.results),
      observedAt:
        sales?.observedAt.toISOString() ??
        assessment?.calculatedAt.toISOString() ??
        null,
    };
  });
  return {
    universe: {
      projectId: input.projectId,
      kind: "PRODUCT",
      requestedCount: ids.length,
      matchedCount: candidates.length,
    },
    candidates,
    comparisons: candidates.flatMap((left, index) =>
      candidates.slice(index + 1).map((right) => ({
        leftId: left.id,
        rightId: right.id,
        reasons: explainProductComparison(left, right),
      })),
    ),
  };
}

export async function compareProjectNiches(input: {
  organizationId: string;
  projectId: string;
  ids: readonly string[];
}) {
  const ids = limitIds(input.ids);
  const items = await db.researchProjectItem.findMany({
    where: {
      organizationId: input.organizationId,
      projectId: input.projectId,
      kind: "MARKET",
      marketDefinitionId: { in: ids },
    },
    include: {
      marketDefinition: {
        include: {
          nicheAssessments: { orderBy: { calculatedAt: "desc" }, take: 1 },
        },
      },
    },
  });
  if (items.length !== ids.length)
    throw new Error("COMPARISON_NICHE_NOT_IN_PROJECT");
  const candidates = items.map((item) => {
    const assessment = item.marketDefinition!.nicheAssessments[0];
    return {
      id: item.marketDefinitionId!,
      label: item.displayLabel ?? item.marketDefinition!.name,
      opportunityScore: decimal(assessment?.score),
      confidencePercent: decimal(assessment?.confidencePercent),
      observedAt: assessment?.calculatedAt.toISOString() ?? null,
    };
  });
  return {
    universe: {
      projectId: input.projectId,
      kind: "MARKET",
      requestedCount: ids.length,
      matchedCount: candidates.length,
    },
    candidates,
    comparisons: candidates.flatMap((left, index) =>
      candidates.slice(index + 1).map((right) => ({
        leftId: left.id,
        rightId: right.id,
        reasons: explainProductComparison(
          left as ProductCandidate,
          right as ProductCandidate,
        ),
      })),
    ),
  };
}
