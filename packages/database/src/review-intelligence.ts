import { createHash } from "node:crypto";

export type ReviewThemeCandidate = {
  kind:
    | "COMPLAINT"
    | "PRAISE"
    | "QUALITY"
    | "SIZING_COMPATIBILITY"
    | "PACKAGING"
    | "MISSING_FEATURE"
    | "DURABILITY"
    | "INSTRUCTIONS";
  label: string;
};

export const REVIEW_CLUSTERING_VERSION = "RULES_V1";

export type ReviewClusteringInput = {
  id: string;
  rating: number;
  bodyRedacted: string;
};

export type ReviewThemeCluster = ReviewThemeCandidate & {
  reviewCount: number;
  averageRating: string;
  evidenceReviewIds: string[];
  methodVersion: typeof REVIEW_CLUSTERING_VERSION;
};

const patterns: Array<{ match: RegExp; theme: ReviewThemeCandidate }> = [
  {
    match: /packag|box|arrived damaged/i,
    theme: { kind: "PACKAGING", label: "Packaging" },
  },
  {
    match: /size|fit|compatib/i,
    theme: { kind: "SIZING_COMPATIBILITY", label: "Sizing or compatibility" },
  },
  {
    match: /durab|broke|break|lasted/i,
    theme: { kind: "DURABILITY", label: "Durability" },
  },
  {
    match: /instruction|manual|confus|how to/i,
    theme: { kind: "INSTRUCTIONS", label: "Instructions or usability" },
  },
  {
    match: /missing|wish.*had|need.*feature/i,
    theme: { kind: "MISSING_FEATURE", label: "Missing feature" },
  },
  {
    match: /quality|defect|flimsy/i,
    theme: { kind: "QUALITY", label: "Quality" },
  },
  {
    match: /love|great|excellent|perfect/i,
    theme: { kind: "PRAISE", label: "Praised attribute" },
  },
];

export function redactReviewText(value: string): string {
  return value
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, "[redacted-email]")
    .replace(/\b(?:\+?\d[\d ()-]{7,}\d)\b/g, "[redacted-phone]")
    .replace(
      /\b(?:order|invoice)\s*#?\s*[A-Z0-9-]{5,}\b/gi,
      "[redacted-reference]",
    )
    .trim();
}

export function reviewDedupeHash(
  sourceReference: string,
  redactedBody: string,
): string {
  return createHash("sha256")
    .update(`${sourceReference}\n${redactedBody}`)
    .digest("hex");
}

export function classifyReviewTheme(
  bodyRedacted: string,
  rating: number,
): ReviewThemeCandidate {
  const match = patterns.find((pattern) => pattern.match.test(bodyRedacted));
  if (match) return match.theme;
  return rating <= 2
    ? { kind: "COMPLAINT", label: "General complaint" }
    : { kind: "PRAISE", label: "General praise" };
}

/** Deterministic evidence grouping used by both persistence and golden evals. */
export function clusterReviewThemes(
  reviews: readonly ReviewClusteringInput[],
): ReviewThemeCluster[] {
  const grouped = new Map<
    string,
    ReviewThemeCandidate & { ids: string[]; ratings: number[] }
  >();
  for (const review of [...reviews].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    if (
      !Number.isInteger(review.rating) ||
      review.rating < 1 ||
      review.rating > 5
    )
      throw new Error("REVIEW_RATING_INVALID");
    const theme = classifyReviewTheme(review.bodyRedacted, review.rating);
    const key = `${theme.kind}:${theme.label}`;
    const value = grouped.get(key) ?? { ...theme, ids: [], ratings: [] };
    value.ids.push(review.id);
    value.ratings.push(review.rating);
    grouped.set(key, value);
  }
  return [...grouped.values()]
    .map<ReviewThemeCluster>((theme) => ({
      kind: theme.kind,
      label: theme.label,
      reviewCount: theme.ids.length,
      averageRating: (
        theme.ratings.reduce((total, rating) => total + rating, 0) /
        theme.ratings.length
      ).toFixed(2),
      evidenceReviewIds: theme.ids,
      methodVersion: REVIEW_CLUSTERING_VERSION,
    }))
    .sort(
      (left, right) =>
        right.reviewCount - left.reviewCount ||
        left.kind.localeCompare(right.kind) ||
        left.label.localeCompare(right.label),
    );
}
