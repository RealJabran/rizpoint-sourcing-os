import { db } from "../client.js";
import {
  clusterReviewThemes,
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
  const themes = clusterReviewThemes(reviews);
  const calculatedAt = new Date();
  await db.$transaction(
    themes.map((theme) =>
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
          reviewCount: theme.reviewCount,
          averageRating: theme.averageRating,
          evidenceReviewIds: theme.evidenceReviewIds,
          methodVersion: theme.methodVersion,
          calculatedAt,
        },
        update: {
          reviewCount: theme.reviewCount,
          averageRating: theme.averageRating,
          evidenceReviewIds: theme.evidenceReviewIds,
          methodVersion: theme.methodVersion,
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
