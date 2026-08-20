import { db } from "../client.js";

export const DIFFERENTIATION_SUMMARY_VERSION = "differentiation-brief/v1";

type BriefEvidence = {
  themeId: string;
  kind: string;
  label: string;
  reviewCount: number;
  averageRating: string | null;
  evidenceReviewIds: string[];
};

export type DifferentiationBrief = {
  product: {
    id: string;
    title: string;
    brand: string | null;
    provider: string;
    observedAt: string;
  };
  evidence: BriefEvidence[];
  hypotheses: Array<{
    label: string;
    recommendation: string;
    validationQuestion: string;
    confidence: "LOW" | "MEDIUM";
    supportingSignals: string[];
    evidenceReviewIds: string[];
  }>;
  missingInputs: string[];
};

export function hypothesisFor(
  evidence: BriefEvidence,
): DifferentiationBrief["hypotheses"][number] {
  const wording: Record<string, { recommendation: string; question: string }> =
    {
      PACKAGING: {
        recommendation: "Test a more protective packaging approach.",
        question:
          "What packaging options can withstand the expected fulfillment path?",
      },
      INSTRUCTIONS: {
        recommendation: "Test clearer setup and care instructions.",
        question:
          "Can the supplier provide validated setup, care, and troubleshooting materials?",
      },
      SIZING_COMPATIBILITY: {
        recommendation: "Test clearer compatibility or sizing guidance.",
        question:
          "Which dimensions, fit tolerances, and compatibility constraints can be documented?",
      },
      DURABILITY: {
        recommendation:
          "Investigate durability expectations before selecting materials.",
        question:
          "Which repeat-use and failure-mode checks can the supplier document?",
      },
      MISSING_FEATURE: {
        recommendation:
          "Investigate whether a requested feature is feasible and compliant.",
        question:
          "Can the supplier validate the requested feature without creating a safety or IP claim?",
      },
      QUALITY: {
        recommendation: "Investigate quality-control checkpoints.",
        question:
          "Which measurable quality-control checks can be agreed before ordering?",
      },
      COMPLAINT: {
        recommendation: "Investigate the recurring customer concern.",
        question:
          "What evidence would disprove or confirm this concern with target users and suppliers?",
      },
      PRAISE: {
        recommendation:
          "Preserve the attribute customers already praise while validating alternatives.",
        question:
          "Which praised attribute must remain unchanged in supplier samples?",
      },
    };
  const selected = wording[evidence.kind] ?? wording.COMPLAINT!;
  return {
    label: `${evidence.label} hypothesis`,
    recommendation: selected.recommendation,
    validationQuestion: selected.question,
    confidence: evidence.reviewCount >= 5 ? "MEDIUM" : "LOW",
    supportingSignals: [
      `${evidence.reviewCount} linked authorized review(s)`,
      `Theme rating: ${evidence.averageRating ?? "unavailable"}`,
    ],
    evidenceReviewIds: evidence.evidenceReviewIds,
  };
}

export async function createDifferentiationBrief(input: {
  organizationId: string;
  catalogProductId: string;
}): Promise<DifferentiationBrief> {
  const product = await db.catalogProduct.findFirst({
    where: {
      id: input.catalogProductId,
      OR: [
        {
          researchProjectItems: {
            some: { organizationId: input.organizationId },
          },
        },
        { marketMembers: { some: { organizationId: input.organizationId } } },
        { productWatches: { some: { organizationId: input.organizationId } } },
      ],
    },
    select: {
      id: true,
      title: true,
      brand: true,
      provider: true,
      observedAt: true,
    },
  });
  if (!product) throw new Error("CATALOG_PRODUCT_NOT_IN_RESEARCH_UNIVERSE");
  const themes = await db.reviewTheme.findMany({
    where: {
      organizationId: input.organizationId,
      catalogProductId: input.catalogProductId,
    },
    orderBy: { reviewCount: "desc" },
  });
  const evidence = themes.map((theme) => ({
    themeId: theme.id,
    kind: theme.kind,
    label: theme.label,
    reviewCount: theme.reviewCount,
    averageRating: theme.averageRating?.toString() ?? null,
    evidenceReviewIds: Array.isArray(theme.evidenceReviewIds)
      ? theme.evidenceReviewIds.filter(
          (id): id is string => typeof id === "string",
        )
      : [],
  }));
  return {
    product: { ...product, observedAt: product.observedAt.toISOString() },
    evidence,
    hypotheses: evidence.map(hypothesisFor),
    missingInputs: [
      "Licensed competitor feature frequency",
      "Licensed price-band and variation data",
      "Authorized keyword-intent data",
      "Return/compliance evidence",
    ],
  };
}

export async function exportDifferentiationBrief(input: {
  organizationId: string;
  projectId: string;
  brief: DifferentiationBrief;
}) {
  const project = await db.researchProject.findFirst({
    where: { id: input.projectId, organizationId: input.organizationId },
    select: { id: true },
  });
  if (!project) throw new Error("RESEARCH_PROJECT_NOT_FOUND");
  const body = [
    `Differentiation Brief — ${input.brief.product.title}`,
    "Evidence (not recommendations):",
    ...input.brief.evidence.map(
      (item) =>
        `- ${item.label}: ${item.reviewCount} linked review(s), rating ${item.averageRating ?? "unavailable"}; review IDs ${item.evidenceReviewIds.join(", ") || "none"}`,
    ),
    "Hypotheses to validate:",
    ...input.brief.hypotheses.map(
      (item) =>
        `- [${item.confidence}] ${item.recommendation} Validation: ${item.validationQuestion}`,
    ),
  ].join("\n");
  return db.researchNote.create({
    data: {
      organizationId: input.organizationId,
      projectId: project.id,
      body,
      evidenceRefs: {
        type: "DIFFERENTIATION_BRIEF_V1",
        productId: input.brief.product.id,
        themes: input.brief.evidence.map((item) => ({
          themeId: item.themeId,
          reviewIds: item.evidenceReviewIds,
        })),
      },
    },
  });
}
