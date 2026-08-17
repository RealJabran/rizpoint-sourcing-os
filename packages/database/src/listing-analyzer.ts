export const LISTING_ANALYZER_RULE_VERSION = "LISTING_RULES_V1";

export type ListingCopy = {
  title: string;
  bullets: string[];
  description?: string;
  targetKeywords: string[];
  prohibitedTerms: string[];
};

export type ListingComponent = {
  key: string;
  label: string;
  score: number | null;
  rule: string;
  state: "PASS" | "OPPORTUNITY" | "RISK" | "UNAVAILABLE";
};

export type ListingWarning = {
  kind: "SEO_OPPORTUNITY" | "COMPLIANCE_RISK" | "CONTENT_QUALITY";
  message: string;
  priority: "HIGH" | "MEDIUM" | "LOW";
};

export type ListingReport = {
  overallScore: number;
  components: ListingComponent[];
  keywordCoverage: Array<{ keyword: string; present: boolean }>;
  warnings: ListingWarning[];
  actions: Array<{
    priority: "HIGH" | "MEDIUM" | "LOW";
    action: string;
    basis: string;
  }>;
  reviewThemesNotAddressed: string[];
};

const complianceTerms = [
  "cure",
  "treat",
  "prevent",
  "guaranteed",
  "guarantee",
  "fda approved",
  "clinically proven",
];

function words(value: string) {
  return value.toLocaleLowerCase("en-US").match(/[\p{L}\p{N}]+/gu) ?? [];
}

function score(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function analyzeListingCopy(
  input: ListingCopy & {
    reviewThemeLabels?: string[] | undefined;
    variationKnown?: boolean | undefined;
  },
): ListingReport {
  const text = [input.title, ...input.bullets, input.description ?? ""].join(
    " ",
  );
  const lowered = text.toLocaleLowerCase("en-US");
  const titleLength = input.title.trim().length;
  const bodyWords = words(text);
  const uniqueWords = new Set(bodyWords);
  const keywordCoverage = [
    ...new Set(
      input.targetKeywords.map((keyword) => keyword.trim()).filter(Boolean),
    ),
  ].map((keyword) => ({
    keyword,
    present: lowered.includes(keyword.toLocaleLowerCase("en-US")),
  }));
  const prohibited = [
    ...new Set([
      ...complianceTerms,
      ...input.prohibitedTerms.map((term) => term.trim()).filter(Boolean),
    ]),
  ].filter((term) => lowered.includes(term.toLocaleLowerCase("en-US")));
  const duplicateRatio = bodyWords.length
    ? 1 - uniqueWords.size / bodyWords.length
    : 1;
  const benefitWords =
    /easy|comfortable|protect|save|simple|convenient|enjoy|help/i.test(text)
      ? 1
      : 0;
  const reviewThemesNotAddressed = (input.reviewThemeLabels ?? []).filter(
    (label) => !words(label).some((word) => lowered.includes(word)),
  );
  const components: ListingComponent[] = [
    {
      key: "title",
      label: "Title structure",
      score:
        titleLength >= 50 && titleLength <= 200 ? 100 : titleLength ? 50 : 0,
      rule: "50–200 characters earns 100; a non-empty title outside that range earns 50.",
      state: titleLength >= 50 && titleLength <= 200 ? "PASS" : "OPPORTUNITY",
    },
    {
      key: "bullets",
      label: "Bullet completeness",
      score: score(
        (Math.min(input.bullets.filter((bullet) => bullet.trim()).length, 5) /
          5) *
          100,
      ),
      rule: "Each of the first five non-empty bullets contributes 20 points.",
      state:
        input.bullets.filter((bullet) => bullet.trim()).length >= 5
          ? "PASS"
          : "OPPORTUNITY",
    },
    {
      key: "keywords",
      label: "Target keyword coverage",
      score: keywordCoverage.length
        ? score(
            (keywordCoverage.filter((item) => item.present).length /
              keywordCoverage.length) *
              100,
          )
        : null,
      rule: "Score is the share of supplied target phrases present verbatim; no ranking effect is asserted.",
      state: keywordCoverage.length
        ? keywordCoverage.every((item) => item.present)
          ? "PASS"
          : "OPPORTUNITY"
        : "UNAVAILABLE",
    },
    {
      key: "redundancy",
      label: "Duplicate language",
      score: score((1 - Math.min(duplicateRatio, 0.5) * 2) * 100),
      rule: "Repeated-token ratio above 50% scores 0; this is a copy-quality heuristic.",
      state: duplicateRatio <= 0.2 ? "PASS" : "OPPORTUNITY",
    },
    {
      key: "benefitBalance",
      label: "Benefit / feature balance",
      score: benefitWords ? 100 : 50,
      rule: "At least one plain benefit-oriented phrase earns 100; this does not verify a product claim.",
      state: benefitWords ? "PASS" : "OPPORTUNITY",
    },
    {
      key: "compliance",
      label: "Compliance-risk language",
      score: prohibited.length ? 0 : 100,
      rule: "Configured prohibited terms and conservative high-risk phrases trigger a risk; this is not legal advice.",
      state: prohibited.length ? "RISK" : "PASS",
    },
    {
      key: "variation",
      label: "Variation structure",
      score: input.variationKnown ? 100 : null,
      rule: "Only an authorized known variation structure is scored; absent data remains unavailable.",
      state: input.variationKnown ? "PASS" : "UNAVAILABLE",
    },
    {
      key: "images",
      label: "Image metadata",
      score: null,
      rule: "Image count is unavailable until an authorized source provides it.",
      state: "UNAVAILABLE",
    },
    {
      key: "aPlus",
      label: "A+ metadata",
      score: null,
      rule: "A+ presence is unavailable until an authorized source provides it.",
      state: "UNAVAILABLE",
    },
  ];
  const warnings: ListingWarning[] = [
    ...prohibited.map((term) => ({
      kind: "COMPLIANCE_RISK" as const,
      priority: "HIGH" as const,
      message: `Review prohibited or high-risk phrase: “${term}”.`,
    })),
    ...keywordCoverage
      .filter((item) => !item.present)
      .map((item) => ({
        kind: "SEO_OPPORTUNITY" as const,
        priority: "MEDIUM" as const,
        message: `Target phrase is absent: “${item.keyword}”.`,
      })),
    ...(duplicateRatio > 0.2
      ? [
          {
            kind: "CONTENT_QUALITY" as const,
            priority: "LOW" as const,
            message: "Repeated language may reduce clarity; review duplicates.",
          },
        ]
      : []),
  ];
  const actions: ListingReport["actions"] = warnings.map((warning) => ({
    priority: warning.priority,
    action: warning.message,
    basis: warning.kind,
  }));
  for (const label of reviewThemesNotAddressed)
    actions.push({
      priority: "MEDIUM",
      action: `Consider whether copy should address the evidence-backed theme “${label}”; validate facts first.`,
      basis: "REVIEW_EVIDENCE",
    });
  const scored = components.flatMap((component) =>
    component.score === null ? [] : [component.score],
  );
  return {
    overallScore: score(
      scored.reduce((sum, value) => sum + value, 0) /
        Math.max(scored.length, 1),
    ),
    components,
    keywordCoverage,
    warnings,
    actions,
    reviewThemesNotAddressed,
  };
}
