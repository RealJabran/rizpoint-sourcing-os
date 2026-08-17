import { Prisma } from "../generated/prisma/client.js";
import {
  analyzeListingCopy,
  LISTING_ANALYZER_RULE_VERSION,
  type ListingCopy,
} from "../listing-analyzer.js";
import { db } from "../client.js";

export async function assessListing(input: {
  organizationId: string;
  catalogProductId: string;
  draft: ListingCopy;
}) {
  const product = await db.catalogProduct.findFirst({
    where: {
      id: input.catalogProductId,
      OR: [
        {
          listingCandidates: { some: { organizationId: input.organizationId } },
        },
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
      variation: true,
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
    select: { id: true, label: true, calculatedAt: true },
  });
  const current: ListingCopy = {
    title: product.title,
    bullets: [],
    description: "",
    targetKeywords: input.draft.targetKeywords,
    prohibitedTerms: input.draft.prohibitedTerms,
  };
  const evidence = {
    catalogProductId: product.id,
    provider: product.provider,
    productObservedAt: product.observedAt.toISOString(),
    reviewThemeIds: themes.map((theme) => theme.id),
    reviewThemesCalculatedAt: themes.map((theme) =>
      theme.calculatedAt.toISOString(),
    ),
  };
  const currentReport = analyzeListingCopy({
    ...current,
    reviewThemeLabels: themes.map((theme) => theme.label),
    variationKnown: product.variation !== null,
  });
  const draftReport = analyzeListingCopy({
    ...input.draft,
    reviewThemeLabels: themes.map((theme) => theme.label),
    variationKnown: product.variation !== null,
  });
  const assessment = await db.listingQualityAssessment.create({
    data: {
      organizationId: input.organizationId,
      catalogProductId: product.id,
      ruleVersion: LISTING_ANALYZER_RULE_VERSION,
      currentSnapshot: current as Prisma.InputJsonValue,
      draftSnapshot: input.draft as Prisma.InputJsonValue,
      report: {
        current: currentReport,
        draft: draftReport,
      } as Prisma.InputJsonValue,
      evidenceRefs: evidence as Prisma.InputJsonValue,
      calculatedAt: new Date(),
    },
  });
  return {
    id: assessment.id,
    ruleVersion: assessment.ruleVersion,
    current: currentReport,
    draft: draftReport,
    evidence,
  };
}
