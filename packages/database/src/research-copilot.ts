import { db } from "./client.js";

export const COPILOT_OPERATIONS = [
  "NICHE_DISCOVERY",
  "DECISION_RISKS",
  "PRODUCT_COMPLIANCE",
] as const;
export type CopilotOperation = (typeof COPILOT_OPERATIONS)[number];
export type CopilotAnswer = {
  operation: CopilotOperation;
  facts: Array<{ text: string; citationId: string; observedAt?: string }>;
  derived: string[];
  hypotheses: string[];
  missing: string[];
  safeguards: string[];
};

/** Removes instructions from untrusted text; retrieval never executes its text. */
export function sanitizeCopilotQuestion(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(
      /(?:ignore|system prompt|developer message|tool call|sql|delete|update|insert)\b/gi,
      "[redacted]",
    )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 800);
}
export function selectCopilotOperation(question: string): CopilotOperation {
  const normalized = sanitizeCopilotQuestion(question).toLowerCase();
  if (/assumption|go\/?no-go|decision|reverse.*decision/.test(normalized))
    return "DECISION_RISKS";
  if (/complian|risk|restricted/.test(normalized)) return "PRODUCT_COMPLIANCE";
  return "NICHE_DISCOVERY";
}
export async function retrieveCopilotAnswer(input: {
  organizationId: string;
  question: string;
  projectId?: string;
}): Promise<CopilotAnswer> {
  const operation = selectCopilotOperation(input.question);
  const base = {
    operation,
    hypotheses: [
      "No hypothesis is asserted as a stored fact; validate it against cited evidence.",
    ],
    safeguards: [
      "Allowlisted read-only retrieval only",
      "Tenant-scoped database predicates",
      "No raw provider payloads or financial calculation authority",
    ],
  };
  if (operation === "NICHE_DISCOVERY") {
    const rows = await db.nicheAssessment.findMany({
      where: {
        organizationId: input.organizationId,
        ...(input.projectId
          ? { marketDefinition: { projectId: input.projectId } }
          : {}),
      },
      include: { marketDefinition: { select: { name: true } } },
      orderBy: { calculatedAt: "desc" },
      take: 25,
    });
    return {
      ...base,
      facts: rows.map((row) => ({
        text: `${row.marketDefinition.name}: opportunity ${row.score?.toString() ?? "unavailable"}; confidence ${row.confidencePercent?.toString() ?? "unavailable"}.`,
        citationId: `NicheAssessment:${row.id}`,
        observedAt: row.calculatedAt.toISOString(),
      })),
      derived: [
        "Results are ordered by observation time, not a new copilot score.",
      ],
      missing: rows.length
        ? []
        : ["No stored niche assessments matched this tenant/project."],
    };
  }
  if (operation === "DECISION_RISKS") {
    const rows = await db.decisionMemo.findMany({
      where: {
        organizationId: input.organizationId,
        ...(input.projectId ? { projectId: input.projectId } : {}),
      },
      include: {
        project: {
          include: {
            assumptions: { orderBy: { assumedAt: "desc" }, take: 10 },
          },
        },
      },
      orderBy: { decidedAt: "desc" },
      take: 10,
    });
    return {
      ...base,
      facts: rows.flatMap((row) => [
        {
          text: `${row.title}: ${row.outcome} recorded by ${row.decisionOwner}.`,
          citationId: `DecisionMemo:${row.id}`,
          observedAt: row.decidedAt.toISOString(),
        },
        ...row.project.assumptions.map((assumption) => ({
          text: `${assumption.label}: ${assumption.value}`,
          citationId: `ProjectAssumption:${assumption.id}`,
          observedAt: assumption.assumedAt.toISOString(),
        })),
      ]),
      derived: [
        "Decision risk is represented by the recorded assumptions, not recalculated by the copilot.",
      ],
      missing: rows.length
        ? []
        : ["No decision memo is stored for this tenant/project."],
    };
  }
  const rows = await db.complianceRiskAssessment.findMany({
    where: {
      organizationId: input.organizationId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
    },
    include: { catalogProduct: { select: { asin: true, title: true } } },
    orderBy: { calculatedAt: "desc" },
    take: 25,
  });
  return {
    ...base,
    facts: rows.map((row) => ({
      text: `${row.catalogProduct?.title ?? "Project-level assessment"} (${row.catalogProduct?.asin ?? "no ASIN"}): stored compliance result available.`,
      citationId: `ComplianceRiskAssessment:${row.id}`,
      observedAt: row.calculatedAt.toISOString(),
    })),
    derived: [
      "Compliance results are deterministic rule assessments and remain evidence-linked.",
    ],
    missing: rows.length
      ? []
      : ["No compliance assessment is stored for this tenant/project."],
  };
}
