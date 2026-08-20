export const COMPLIANCE_RISK_DOMAINS = [
  "INGESTIBLE_FOOD_SUPPLEMENT",
  "COSMETIC_TOPICAL",
  "MEDICAL_HEALTH_CLAIMS",
  "CHILDRENS_PRODUCT",
  "BATTERY",
  "RADIO_WIRELESS",
  "ELECTRICAL_MAINS",
  "LASER",
  "PPE_SAFETY",
  "CHEMICAL_HAZARDOUS_MATERIAL",
  "FLAMMABLE_AEROSOL",
  "AUTOMOTIVE_SAFETY",
  "PET_CONSUMABLE",
  "TEXTILE_APPAREL_LABELING",
  "COUNTRY_ORIGIN_LABELING",
  "IP_TRADEMARK_PATENT",
  "AMAZON_RESTRICTED_CATEGORY",
] as const;

export const COMPLIANCE_SCREEN_VERSION = "compliance-risk-screen/v1";

export type ComplianceScreenDomain = (typeof COMPLIANCE_RISK_DOMAINS)[number];
export type ComplianceScreenRiskLevel = "LOW" | "REVIEW" | "HIGH" | "UNKNOWN";

export type ScreeningRule = {
  id: string;
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

export type RuleSource = {
  ruleSetId: string;
  ruleSetName: string;
  ruleSetVersion: string;
  sourceTitle: string;
  sourceUrl: string;
  sourcePublishedAt: Date;
  sourceAccessedAt: Date;
};

export type AmazonRestrictionEvidence = {
  state:
    | "ELIGIBLE"
    | "RESTRICTED"
    | "APPROVAL_REQUIRED"
    | "INCOMPLETE"
    | "UNAUTHORIZED"
    | "THROTTLED"
    | "UNKNOWN";
  provider: string;
  observedAt: Date;
  reference: string;
};

export type ComplianceScreenResult = {
  domain: ComplianceScreenDomain;
  riskLevel: ComplianceScreenRiskLevel;
  why: string;
  evidence: Array<{
    kind: "CURATED_RULE" | "AUTHORIZED_SELLER_RESTRICTION" | "NO_MATCH";
    reference: string;
    sourceTitle?: string | undefined;
    sourceUrl?: string | undefined;
    sourcePublishedAt?: string | undefined;
    observedAt?: string | undefined;
  }>;
  questionsToAskSupplier: string[];
  likelyDocumentation: string[];
  doNotLaunchUntilVerified: boolean;
};

const riskRank: Record<ComplianceScreenRiskLevel, number> = {
  UNKNOWN: 0,
  LOW: 1,
  REVIEW: 2,
  HIGH: 3,
};

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function matchingTerms(text: string, terms: string[]) {
  const normalized = text.toLocaleLowerCase();
  return unique(terms).filter((term) =>
    normalized.includes(term.toLocaleLowerCase()),
  );
}

function unknownResult(domain: ComplianceScreenDomain): ComplianceScreenResult {
  return {
    domain,
    riskLevel: "UNKNOWN",
    why: "No configured rule matched the supplied research evidence. This screen cannot determine whether approvals, certifications, restrictions, or labels apply.",
    evidence: [{ kind: "NO_MATCH", reference: "No matching curated rule" }],
    questionsToAskSupplier: [
      "Which approvals, restrictions, labels, test reports, or certifications may apply in the selected marketplace and jurisdiction?",
    ],
    likelyDocumentation: [
      "No specific documentation is identified by the configured rules; verify with an authoritative source.",
    ],
    doNotLaunchUntilVerified: true,
  };
}

function amazonRestrictionResult(
  evidence: AmazonRestrictionEvidence | undefined,
): ComplianceScreenResult {
  const result = unknownResult("AMAZON_RESTRICTED_CATEGORY");
  if (!evidence) return result;
  const baseEvidence = {
    kind: "AUTHORIZED_SELLER_RESTRICTION" as const,
    reference: evidence.reference,
    sourceTitle: evidence.provider,
    observedAt: evidence.observedAt.toISOString(),
  };
  if (evidence.state === "RESTRICTED")
    return {
      ...result,
      riskLevel: "HIGH",
      why: "An authorized seller-restriction observation reports RESTRICTED for this seller and marketplace. This is seller eligibility evidence, not a legal compliance conclusion.",
      evidence: [baseEvidence],
    };
  if (evidence.state === "APPROVAL_REQUIRED")
    return {
      ...result,
      riskLevel: "REVIEW",
      why: "An authorized seller-restriction observation reports APPROVAL_REQUIRED. Confirm approval requirements with Amazon and the applicable authorities before launch.",
      evidence: [baseEvidence],
    };
  if (evidence.state === "ELIGIBLE")
    return {
      ...result,
      why: "An authorized seller-restriction observation reports ELIGIBLE for this seller. Seller eligibility is not a certification or compliance clearance.",
      evidence: [baseEvidence],
    };
  return {
    ...result,
    why: `The authorized seller-restriction observation is ${evidence.state}; no compliance conclusion can be drawn.`,
    evidence: [baseEvidence],
  };
}

/**
 * Deterministically screens only the configured curated rules. A missing
 * match remains UNKNOWN by design. It does not use AI and never implies that a
 * product is free of certification obligations.
 */
export function screenComplianceRisk(input: {
  text: string;
  rules: ScreeningRule[];
  ruleSet: RuleSource;
  amazonRestriction?: AmazonRestrictionEvidence | undefined;
}): ComplianceScreenResult[] {
  const text = input.text.trim();
  const results = COMPLIANCE_RISK_DOMAINS.map((domain) => {
    if (domain === "AMAZON_RESTRICTED_CATEGORY")
      return amazonRestrictionResult(input.amazonRestriction);
    const matches = input.rules
      .filter((rule) => rule.domain === domain)
      .map((rule) => ({ rule, terms: matchingTerms(text, rule.matchTerms) }))
      .filter(({ terms }) => terms.length > 0);
    if (!matches.length) return unknownResult(domain);
    const selected = matches.reduce((highest, candidate) =>
      riskRank[candidate.rule.riskLevel] > riskRank[highest.rule.riskLevel]
        ? candidate
        : highest,
    );
    // A non-authoritative LOW rule must not be represented as a clearance.
    const riskLevel =
      selected.rule.riskLevel === "LOW" && !selected.rule.authoritativeClearance
        ? "UNKNOWN"
        : selected.rule.riskLevel;
    const evidence = matches.map(({ rule, terms }) => ({
      kind: "CURATED_RULE" as const,
      reference: `${input.ruleSet.ruleSetName} ${input.ruleSet.ruleSetVersion}; rule ${rule.id}; matched: ${terms.join(", ")}`,
      sourceTitle: rule.sourceTitle,
      sourceUrl: rule.sourceUrl,
      sourcePublishedAt: rule.sourcePublishedAt.toISOString(),
    }));
    return {
      domain,
      riskLevel,
      why:
        riskLevel === "UNKNOWN" && selected.rule.riskLevel === "LOW"
          ? "A LOW risk rule matched but does not have an authoritative clearance source, so the result remains UNKNOWN."
          : `${selected.rule.rationale} Matched terms: ${selected.terms.join(", ")}.`,
      evidence,
      questionsToAskSupplier: unique(
        matches.flatMap(({ rule }) => rule.supplierQuestions),
      ),
      likelyDocumentation: unique(
        matches.flatMap(({ rule }) => rule.likelyDocumentation),
      ),
      doNotLaunchUntilVerified: riskLevel !== "LOW",
    };
  });
  return results;
}
