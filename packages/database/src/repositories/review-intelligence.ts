import { db } from "../client.js";
import {
  classifyReviewTheme,
  redactReviewText,
  reviewDedupeHash,
} from "../review-intelligence.js";

export async function ingestAuthorizedReview(input: {
  organizationId: string;
  catalogProductId: string;
  source: "LICENSED_PROVIDER" | "USER_IMPORT" | "AUTHORIZED_OTHER";
  sourceReference: string;
  rating: number;
  body: string;
  observedAt: Date;
  language?: string | undefined;
}) {
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5)
    throw new Error("REVIEW_RATING_INVALID");
  const bodyRedacted = redactReviewText(input.body);
  if (!bodyRedacted) throw new Error("REVIEW_BODY_REQUIRED");
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
    select: { id: true },
  });
  if (!product) throw new Error("CATALOG_PRODUCT_NOT_IN_RESEARCH_UNIVERSE");
  const dedupeHash = reviewDedupeHash(input.sourceReference, bodyRedacted);
  return db.authorizedReview.upsert({
    where: {
      organizationId_source_dedupeHash: {
        organizationId: input.organizationId,
        source: input.source,
        dedupeHash,
      },
    },
    create: {
      organizationId: input.organizationId,
      catalogProductId: input.catalogProductId,
      source: input.source,
      sourceReference: input.sourceReference,
      dedupeHash,
      rating: input.rating,
      bodyRedacted,
      observedAt: input.observedAt,
      normalizedLanguage: input.language?.trim().toLowerCase() || "und",
    },
    update: {},
  });
}

export async function rebuildReviewThemes(input: {
  organizationId: string;
  catalogProductId: string;
}) {
  const reviews = await db.authorizedReview.findMany({
    where: {
      organizationId: input.organizationId,
      catalogProductId: input.catalogProductId,
    },
    select: { id: true, rating: true, bodyRedacted: true },
  });
  const grouped = new Map<
    string,
    {
      kind: ReturnType<typeof classifyReviewTheme>["kind"];
      label: string;
      ids: string[];
      ratings: number[];
    }
  >();
  for (const review of reviews) {
    const theme = classifyReviewTheme(review.bodyRedacted, review.rating);
    const key = `${theme.kind}:${theme.label}`;
    const value = grouped.get(key) ?? { ...theme, ids: [], ratings: [] };
    value.ids.push(review.id);
    value.ratings.push(review.rating);
    grouped.set(key, value);
  }
  const calculatedAt = new Date();
  await db.$transaction(
    [...grouped.values()].map((theme) =>
      db.reviewTheme.upsert({
        where: {
          organizationId_catalogProductId_kind_label: {
            organizationId: input.organizationId,
            catalogProductId: input.catalogProductId,
            kind: theme.kind,
            label: theme.label,
          },
        },
        create: {
          organizationId: input.organizationId,
          catalogProductId: input.catalogProductId,
          kind: theme.kind,
          label: theme.label,
          reviewCount: theme.ids.length,
          averageRating: (
            theme.ratings.reduce((total, rating) => total + rating, 0) /
            theme.ratings.length
          ).toFixed(2),
          evidenceReviewIds: theme.ids,
          methodVersion: "RULES_V1",
          calculatedAt,
        },
        update: {
          reviewCount: theme.ids.length,
          averageRating: (
            theme.ratings.reduce((total, rating) => total + rating, 0) /
            theme.ratings.length
          ).toFixed(2),
          evidenceReviewIds: theme.ids,
          methodVersion: "RULES_V1",
          calculatedAt,
        },
      }),
    ),
  );
  return listReviewIntelligence(input);
}

export async function listReviewIntelligence(input: {
  organizationId: string;
  catalogProductId: string;
}) {
  const [themes, reviews] = await Promise.all([
    db.reviewTheme.findMany({
      where: input,
      orderBy: [{ reviewCount: "desc" }, { label: "asc" }],
    }),
    db.authorizedReview.findMany({
      where: input,
      orderBy: { observedAt: "desc" },
      take: 100,
      select: {
        id: true,
        rating: true,
        bodyRedacted: true,
        source: true,
        observedAt: true,
      },
    }),
  ]);
  return { themes, reviews };
}
