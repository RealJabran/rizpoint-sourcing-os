import { Prisma } from "../generated/prisma/client.js";
import { db } from "../client.js";
import { listingDraftCanBeApproved } from "../listing-builder-policy.js";

type ListingContent = {
  title: string;
  bullets: string[];
  description: string;
  backendSearchTerms: string[];
  imageBrief: string[];
  aPlusOutline: string[];
  faqIdeas: string[];
};

function words(input: string[]) {
  return [...new Set(input.map((item) => item.trim()).filter(Boolean))].slice(
    0,
    30,
  );
}
function friendlyKey(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export async function createVerifiedProductFact(input: {
  organizationId: string;
  projectId: string;
  factKey: string;
  value: string;
  evidenceReference: string;
  source: "USER_VERIFIED" | "AUTHORIZED_SOURCE";
}) {
  if (
    !input.factKey.trim() ||
    !input.value.trim() ||
    !input.evidenceReference.trim()
  )
    throw new Error("VERIFIED_FACT_FIELDS_REQUIRED");
  const project = await db.researchProject.findFirst({
    where: { id: input.projectId, organizationId: input.organizationId },
    select: { id: true },
  });
  if (!project) throw new Error("RESEARCH_PROJECT_NOT_FOUND");
  return db.productFact.upsert({
    where: {
      organizationId_projectId_factKey_value: {
        organizationId: input.organizationId,
        projectId: input.projectId,
        factKey: input.factKey.trim(),
        value: input.value.trim(),
      },
    },
    create: {
      ...input,
      factKey: input.factKey.trim(),
      value: input.value.trim(),
      evidenceReference: input.evidenceReference.trim(),
      verifiedAt: new Date(),
    },
    update: {
      evidenceReference: input.evidenceReference.trim(),
      source: input.source,
      verifiedAt: new Date(),
    },
  });
}

export async function generateFactBoundListingDraft(input: {
  organizationId: string;
  projectId: string;
  keywords: string[];
  brandVoice?: string | undefined;
  prohibitedTerms: string[];
  categoryConstraints: string[];
  differentiationBriefNoteId?: string | undefined;
}) {
  const project = await db.researchProject.findFirst({
    where: { id: input.projectId, organizationId: input.organizationId },
    select: { id: true, name: true, marketplaceId: true },
  });
  if (!project) throw new Error("RESEARCH_PROJECT_NOT_FOUND");
  const facts = await db.productFact.findMany({
    where: { organizationId: input.organizationId, projectId: input.projectId },
    orderBy: { verifiedAt: "asc" },
  });
  if (!facts.length) throw new Error("VERIFIED_PRODUCT_FACT_REQUIRED");
  if (input.differentiationBriefNoteId) {
    const note = await db.researchNote.findFirst({
      where: {
        id: input.differentiationBriefNoteId,
        organizationId: input.organizationId,
        projectId: input.projectId,
      },
      select: { id: true },
    });
    if (!note) throw new Error("DIFFERENTIATION_BRIEF_NOT_IN_PROJECT");
  }
  const keywords = words(input.keywords);
  const primary =
    facts.find((fact) => /name|product/i.test(fact.factKey)) ?? facts[0]!;
  const title = [primary.value, keywords[0]].filter(Boolean).join(" — ");
  const bullets = facts
    .slice(0, 5)
    .map((fact) => `${friendlyKey(fact.factKey)}: ${fact.value}`);
  const content: ListingContent = {
    title,
    bullets,
    description: bullets.join(". "),
    backendSearchTerms: keywords,
    imageBrief: facts
      .slice(0, 4)
      .map(
        (fact) => `Show verified ${friendlyKey(fact.factKey)}: ${fact.value}`,
      ),
    aPlusOutline: facts
      .slice(0, 4)
      .map(
        (fact) =>
          `Verified detail — ${friendlyKey(fact.factKey)}: ${fact.value}`,
      ),
    faqIdeas: facts
      .slice(0, 3)
      .map(
        (fact) =>
          `What is the verified ${friendlyKey(fact.factKey).toLowerCase()}? ${fact.value}`,
      ),
  };
  const latest = await db.listingDraft.aggregate({
    where: { organizationId: input.organizationId, projectId: input.projectId },
    _max: { version: true },
  });
  const version = (latest._max.version ?? 0) + 1;
  const warnings = {
    status: "FACT_BOUND_GENERATION",
    brandVoice: input.brandVoice?.trim() || null,
    prohibitedTerms: words(input.prohibitedTerms),
    categoryConstraints: words(input.categoryConstraints),
    differentiationBriefNoteId: input.differentiationBriefNoteId ?? null,
    keywordStuffing:
      keywords.join(" ").length > 249
        ? "BACKEND_TERMS_EXCEED_249_CHARACTERS"
        : null,
  };
  return db.listingDraft.create({
    data: {
      organizationId: input.organizationId,
      projectId: input.projectId,
      marketplaceId: project.marketplaceId,
      version,
      content: content as Prisma.InputJsonValue,
      keywordRefs: keywords,
      warnings: warnings as Prisma.InputJsonValue,
      claims: {
        create: facts.flatMap((fact) => [
          {
            organizationId: input.organizationId,
            section: "title",
            phrase: fact.value,
            status: "VERIFIED",
            productFactId: fact.id,
            keywordRefs: keywords.filter((keyword) =>
              title.toLocaleLowerCase().includes(keyword.toLocaleLowerCase()),
            ),
          },
          {
            organizationId: input.organizationId,
            section: "generated_content",
            phrase: fact.value,
            status: "VERIFIED",
            productFactId: fact.id,
            keywordRefs: [],
          },
        ]),
      },
    },
    include: { claims: true },
  });
}

export async function reviseListingDraft(input: {
  organizationId: string;
  draftId: string;
  section: keyof ListingContent;
  value: string;
}) {
  const current = await db.listingDraft.findFirst({
    where: { id: input.draftId, organizationId: input.organizationId },
    include: { claims: true },
  });
  if (!current) throw new Error("LISTING_DRAFT_NOT_FOUND");
  const content = current.content as unknown as ListingContent;
  const revised = {
    ...content,
    [input.section]:
      input.section === "bullets" ||
      input.section === "backendSearchTerms" ||
      input.section === "imageBrief" ||
      input.section === "aPlusOutline" ||
      input.section === "faqIdeas"
        ? input.value
            .split("\n")
            .map((item) => item.trim())
            .filter(Boolean)
        : input.value,
  } as ListingContent;
  const version = current.version + 1;
  return db.$transaction(async (transaction) =>
    transaction.listingDraft.create({
      data: {
        organizationId: current.organizationId,
        projectId: current.projectId,
        marketplaceId: current.marketplaceId,
        version,
        content: revised as Prisma.InputJsonValue,
        keywordRefs: current.keywordRefs as Prisma.InputJsonValue,
        warnings: {
          ...(current.warnings as object),
          manualEdit: { section: input.section, unverified: true },
        } as Prisma.InputJsonValue,
        claims: {
          create: [
            ...current.claims
              .filter((claim) => claim.section !== input.section)
              .map((claim) => ({
                organizationId: claim.organizationId,
                section: claim.section,
                phrase: claim.phrase,
                status: claim.status,
                productFactId: claim.productFactId,
                keywordRefs: claim.keywordRefs as Prisma.InputJsonValue,
              })),
            {
              organizationId: current.organizationId,
              section: input.section,
              phrase: input.value.trim(),
              status: "UNVERIFIED",
              keywordRefs: [],
            },
          ],
        },
      },
      include: { claims: true },
    }),
  );
}

export async function approveListingDraft(input: {
  organizationId: string;
  draftId: string;
}) {
  const draft = await db.listingDraft.findFirst({
    where: { id: input.draftId, organizationId: input.organizationId },
    include: {
      claims: { where: { status: "UNVERIFIED" }, select: { status: true } },
    },
  });
  if (!draft) throw new Error("LISTING_DRAFT_NOT_FOUND");
  if (!listingDraftCanBeApproved(draft.claims.map((claim) => claim.status)))
    throw new Error("UNVERIFIED_CLAIMS_BLOCK_APPROVAL");
  return db.listingDraft.update({
    where: { id: draft.id },
    data: { status: "APPROVED" },
  });
}

export async function listListingBuilderProject(input: {
  organizationId: string;
  projectId: string;
}) {
  const project = await db.researchProject.findFirst({
    where: { id: input.projectId, organizationId: input.organizationId },
    select: { id: true, marketplaceId: true },
  });
  if (!project) throw new Error("RESEARCH_PROJECT_NOT_FOUND");
  const [facts, drafts] = await Promise.all([
    db.productFact.findMany({
      where: {
        organizationId: input.organizationId,
        projectId: input.projectId,
      },
      orderBy: { verifiedAt: "desc" },
    }),
    db.listingDraft.findMany({
      where: {
        organizationId: input.organizationId,
        projectId: input.projectId,
      },
      include: { claims: true },
      orderBy: { version: "desc" },
      take: 20,
    }),
  ]);
  return { project, facts, drafts };
}
