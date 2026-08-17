import { createHash } from "node:crypto";
import { Prisma } from "../generated/prisma/client.js";
import { db } from "../client.js";
import {
  COMPLIANCE_RISK_DOMAINS,
  screenComplianceRisk,
  type ComplianceScreenDomain,
  type ComplianceScreenRiskLevel,
} from "../compliance-risk-policy.js";

const riskLevels = new Set<ComplianceScreenRiskLevel>([
  "LOW",
  "REVIEW",
  "HIGH",
  "UNKNOWN",
]);
const domains = new Set<string>(COMPLIANCE_RISK_DOMAINS);

export type ComplianceRuleInput = {
  domain: ComplianceScreenDomain;
  riskLevel: ComplianceScreenRiskLevel;
  matchTerms: string[];
  rationale: string;
  supplierQuestions: string[];
  likelyDocumentation: string[];
  authoritativeClearance: boolean;
  sourceTitle: string;
  sourceUrl: string;
  sourcePublishedAt: Date;
};

function strings(value: string[]) {
  return [...new Set(value.map((item) => item.trim()).filter(Boolean))].slice(
    0,
    50,
  );
}

function validDate(value: Date, code: string) {
  if (Number.isNaN(value.getTime())) throw new Error(code);
  return value;
}

function rulesForStorage(rules: ComplianceRuleInput[]) {
  if (!rules.length) throw new Error("COMPLIANCE_RULES_REQUIRED");
  if (rules.length > COMPLIANCE_RISK_DOMAINS.length)
    throw new Error("TOO_MANY_COMPLIANCE_RULES");
  const seen = new Set<string>();
  return rules.map((rule) => {
    if (!domains.has(rule.domain) || !riskLevels.has(rule.riskLevel))
      throw new Error("COMPLIANCE_RULE_INVALID_DOMAIN_OR_RISK");
    if (seen.has(rule.domain))
      throw new Error("COMPLIANCE_RULE_DOMAIN_DUPLICATE");
    seen.add(rule.domain);
    if (
      !rule.rationale.trim() ||
      !rule.sourceTitle.trim() ||
      !rule.sourceUrl.trim()
    )
      throw new Error("COMPLIANCE_RULE_SOURCE_AND_RATIONALE_REQUIRED");
    if (rule.riskLevel === "LOW" && !rule.authoritativeClearance)
      throw new Error("LOW_RISK_REQUIRES_AUTHORITATIVE_CLEARANCE");
    return {
      domain: rule.domain,
      riskLevel: rule.riskLevel,
      matchTerms: strings(rule.matchTerms),
      rationale: rule.rationale.trim(),
      supplierQuestions: strings(rule.supplierQuestions),
      likelyDocumentation: strings(rule.likelyDocumentation),
      authoritativeClearance: rule.authoritativeClearance,
      ruleSourceTitle: rule.sourceTitle.trim(),
      ruleSourceUrl: rule.sourceUrl.trim(),
      ruleSourcePublishedAt: validDate(
        rule.sourcePublishedAt,
        "COMPLIANCE_RULE_SOURCE_DATE_INVALID",
      ),
    };
  });
}

/** Creates an immutable new ruleset version; configured rules are never edited in place. */
export async function createComplianceRuleSetVersion(input: {
  organizationId: string;
  marketplaceId: string;
  jurisdiction: string;
  name: string;
  version: string;
  sourceTitle: string;
  sourceUrl: string;
  sourcePublishedAt: Date;
  sourceAccessedAt: Date;
  rules: ComplianceRuleInput[];
}) {
  if (
    !input.marketplaceId.trim() ||
    !input.jurisdiction.trim() ||
    !input.name.trim() ||
    !input.version.trim() ||
    !input.sourceTitle.trim() ||
    !input.sourceUrl.trim()
  )
    throw new Error("COMPLIANCE_RULESET_FIELDS_REQUIRED");
  const rules = rulesForStorage(input.rules);
  const sourcePublishedAt = validDate(
    input.sourcePublishedAt,
    "COMPLIANCE_RULESET_SOURCE_DATE_INVALID",
  );
  const sourceAccessedAt = validDate(
    input.sourceAccessedAt,
    "COMPLIANCE_RULESET_ACCESS_DATE_INVALID",
  );
  return db.$transaction(async (transaction) => {
    const existing = await transaction.complianceRuleSet.findFirst({
      where: {
        organizationId: input.organizationId,
        marketplaceId: input.marketplaceId.trim(),
        jurisdiction: input.jurisdiction.trim().toUpperCase(),
        version: input.version.trim(),
      },
      select: { id: true },
    });
    if (existing) throw new Error("COMPLIANCE_RULESET_VERSION_EXISTS");
    await transaction.complianceRuleSet.updateMany({
      where: {
        organizationId: input.organizationId,
        marketplaceId: input.marketplaceId.trim(),
        jurisdiction: input.jurisdiction.trim().toUpperCase(),
        status: "ACTIVE",
      },
      data: { status: "ARCHIVED" },
    });
    return transaction.complianceRuleSet.create({
      data: {
        organizationId: input.organizationId,
        marketplaceId: input.marketplaceId.trim(),
        jurisdiction: input.jurisdiction.trim().toUpperCase(),
        name: input.name.trim(),
        version: input.version.trim(),
        sourceTitle: input.sourceTitle.trim(),
        sourceUrl: input.sourceUrl.trim(),
        sourcePublishedAt,
        sourceAccessedAt,
        rules: { create: rules },
      },
      include: { rules: { orderBy: { domain: "asc" } } },
    });
  });
}

export async function listComplianceRiskWorkspace(input: {
  organizationId: string;
  projectId?: string | undefined;
  marketplaceId?: string | undefined;
  jurisdiction?: string | undefined;
}) {
  const where = {
    organizationId: input.organizationId,
    ...(input.marketplaceId?.trim()
      ? { marketplaceId: input.marketplaceId.trim() }
      : {}),
    ...(input.jurisdiction?.trim()
      ? { jurisdiction: input.jurisdiction.trim().toUpperCase() }
      : {}),
  };
  const [ruleSets, project, assessments] = await Promise.all([
    db.complianceRuleSet.findMany({
      where,
      include: { rules: { orderBy: { domain: "asc" } } },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      take: 50,
    }),
    input.projectId
      ? db.researchProject.findFirst({
          where: { id: input.projectId, organizationId: input.organizationId },
          select: { id: true, name: true, marketplaceId: true },
        })
      : null,
    input.projectId
      ? db.complianceRiskAssessment.findMany({
          where: {
            organizationId: input.organizationId,
            projectId: input.projectId,
          },
          include: {
            ruleSet: {
              select: {
                name: true,
                version: true,
                sourceTitle: true,
                sourceUrl: true,
                sourcePublishedAt: true,
                sourceAccessedAt: true,
              },
            },
            catalogProduct: { select: { id: true, asin: true, title: true } },
          },
          orderBy: { calculatedAt: "desc" },
          take: 25,
        })
      : [],
  ]);
  if (input.projectId && !project)
    throw new Error("RESEARCH_PROJECT_NOT_FOUND");
  return { project, ruleSets, assessments };
}

function fingerprint(input: object) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function asStringArray(value: Prisma.JsonValue) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export async function assessComplianceRisk(input: {
  organizationId: string;
  projectId: string;
  ruleSetId: string;
  jurisdiction: string;
  catalogProductId?: string | undefined;
  additionalProductText?: string | undefined;
}) {
  const project = await db.researchProject.findFirst({
    where: { id: input.projectId, organizationId: input.organizationId },
    select: { id: true, marketplaceId: true },
  });
  if (!project) throw new Error("RESEARCH_PROJECT_NOT_FOUND");
  const ruleSet = await db.complianceRuleSet.findFirst({
    where: {
      id: input.ruleSetId,
      organizationId: input.organizationId,
      marketplaceId: project.marketplaceId,
      jurisdiction: input.jurisdiction.trim().toUpperCase(),
      status: "ACTIVE",
    },
    include: { rules: true },
  });
  if (!ruleSet) throw new Error("ACTIVE_COMPLIANCE_RULESET_NOT_FOUND");
  let product: {
    id: string;
    asin: string | null;
    title: string;
    brand: string | null;
    model: string | null;
  } | null = null;
  if (input.catalogProductId) {
    product = await db.catalogProduct.findFirst({
      where: {
        id: input.catalogProductId,
        researchProjectItems: {
          some: {
            organizationId: input.organizationId,
            projectId: input.projectId,
          },
        },
      },
      select: { id: true, asin: true, title: true, brand: true, model: true },
    });
    if (!product) throw new Error("CATALOG_PRODUCT_NOT_IN_PROJECT");
  }
  const facts = await db.productFact.findMany({
    where: { organizationId: input.organizationId, projectId: input.projectId },
    select: { id: true, factKey: true, value: true, evidenceReference: true },
    orderBy: { verifiedAt: "desc" },
    take: 100,
  });
  const additional = input.additionalProductText?.trim() ?? "";
  const productText = [
    product?.title,
    product?.brand,
    product?.model,
    ...facts.map((fact) => `${fact.factKey}: ${fact.value}`),
    additional,
  ]
    .filter(Boolean)
    .join("\n");
  if (!productText.trim()) throw new Error("PRODUCT_EVIDENCE_REQUIRED");
  const restriction = product?.asin
    ? await db.providerObservation.findFirst({
        where: {
          asin: product.asin,
          marketplaceId: project.marketplaceId,
          metricType: "RESTRICTIONS",
          enrichmentItem: {
            enrichmentRun: { organizationId: input.organizationId },
          },
        },
        select: {
          id: true,
          provider: true,
          restrictionState: true,
          observedAt: true,
        },
        orderBy: { observedAt: "desc" },
      })
    : null;
  const results = screenComplianceRisk({
    text: productText,
    rules: ruleSet.rules.map((rule) => ({
      id: rule.id,
      domain: rule.domain,
      riskLevel: rule.riskLevel,
      matchTerms: asStringArray(rule.matchTerms),
      rationale: rule.rationale,
      supplierQuestions: asStringArray(rule.supplierQuestions),
      likelyDocumentation: asStringArray(rule.likelyDocumentation),
      authoritativeClearance: rule.authoritativeClearance,
      sourceTitle: rule.ruleSourceTitle,
      sourceUrl: rule.ruleSourceUrl,
      sourcePublishedAt: rule.ruleSourcePublishedAt,
    })),
    ruleSet: {
      ruleSetId: ruleSet.id,
      ruleSetName: ruleSet.name,
      ruleSetVersion: ruleSet.version,
      sourceTitle: ruleSet.sourceTitle,
      sourceUrl: ruleSet.sourceUrl,
      sourcePublishedAt: ruleSet.sourcePublishedAt,
      sourceAccessedAt: ruleSet.sourceAccessedAt,
    },
    ...(restriction?.restrictionState
      ? {
          amazonRestriction: {
            state: restriction.restrictionState,
            provider: restriction.provider,
            observedAt: restriction.observedAt,
            reference: `ProviderObservation ${restriction.id}`,
          },
        }
      : {}),
  });
  const inputEvidenceReferences = {
    ...(product
      ? {
          catalogProduct: {
            id: product.id,
            asin: product.asin,
            title: product.title,
          },
        }
      : {}),
    productFacts: facts.map((fact) => ({
      id: fact.id,
      evidenceReference: fact.evidenceReference,
    })),
    ...(additional ? { userSuppliedDescription: true } : {}),
    ...(restriction ? { sellerRestrictionObservationId: restriction.id } : {}),
  };
  const inputFingerprint = fingerprint({
    ruleSetId: ruleSet.id,
    jurisdiction: ruleSet.jurisdiction,
    productText,
    inputEvidenceReferences,
    restriction: restriction?.id ?? null,
  });
  return db.complianceRiskAssessment.upsert({
    where: {
      organizationId_projectId_ruleSetId_inputFingerprint: {
        organizationId: input.organizationId,
        projectId: input.projectId,
        ruleSetId: ruleSet.id,
        inputFingerprint,
      },
    },
    create: {
      organizationId: input.organizationId,
      projectId: input.projectId,
      ...(product ? { catalogProductId: product.id } : {}),
      ruleSetId: ruleSet.id,
      marketplaceId: project.marketplaceId,
      jurisdiction: ruleSet.jurisdiction,
      inputText: productText,
      inputFingerprint,
      results: results as unknown as Prisma.InputJsonValue,
      inputEvidenceReferences:
        inputEvidenceReferences as unknown as Prisma.InputJsonValue,
      calculatedAt: new Date(),
    },
    update: {},
    include: {
      ruleSet: {
        select: {
          name: true,
          version: true,
          sourceTitle: true,
          sourceUrl: true,
          sourcePublishedAt: true,
          sourceAccessedAt: true,
        },
      },
      catalogProduct: { select: { id: true, asin: true, title: true } },
    },
  });
}
