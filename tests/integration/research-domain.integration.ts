import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createResearchRepository,
  db,
} from "../../packages/database/src/index.js";

const suffix = randomUUID();
const marketplaceId = "ATVPDKIKX0DER";
const organizations = await Promise.all([
  db.organization.create({
    data: { slug: `research-a-${suffix}`, name: "Research tenant A" },
  }),
  db.organization.create({
    data: { slug: `research-b-${suffix}`, name: "Research tenant B" },
  }),
]);
const [organizationA, organizationB] = organizations;
const repository = createResearchRepository();
let catalogProductId: string | undefined;

try {
  const catalogProduct = await db.catalogProduct.create({
    data: {
      provider: "MOCK_AMAZON",
      providerReference: `research-${suffix}`,
      asin: "B000000001",
      title: "Synthetic research product",
      marketplaceId,
      responseCompleteness: "COMPLETE",
      observedAt: new Date("2026-08-16T08:00:00.000Z"),
      freshnessState: "FRESH",
    },
  });
  catalogProductId = catalogProduct.id;

  const project = await repository.createProject({
    organizationId: organizationA.id,
    name: "Synthetic private-label research",
    mode: "PRIVATE_LABEL",
    marketplaceId,
  });
  const wholesaleProject = await repository.createProject({
    organizationId: organizationB.id,
    name: "Synthetic wholesale research",
    mode: "WHOLESALE",
    marketplaceId,
  });
  assert.equal(project.mode, "PRIVATE_LABEL");
  assert.equal(wholesaleProject.mode, "WHOLESALE");

  const projectItem = await repository.addProjectItem({
    organizationId: organizationA.id,
    projectId: project.id,
    kind: "PRODUCT",
    subjectKey: catalogProduct.id,
    catalogProductId: catalogProduct.id,
  });
  assert.equal(projectItem.catalogProductId, catalogProduct.id);
  await assert.rejects(
    repository.addProjectItem({
      organizationId: organizationB.id,
      projectId: project.id,
      kind: "PRODUCT",
      subjectKey: `cross-tenant-${catalogProduct.id}`,
      catalogProductId: catalogProduct.id,
    }),
    /RESEARCH_PROJECT_NOT_FOUND/,
  );

  const keyword = await repository.createKeyword({
    organizationId: organizationA.id,
    marketplaceId,
    phrase: "  Dog   Beds  ",
    locale: "en-US",
  });
  assert.equal(keyword.normalizedPhrase, "dog beds");

  const observedAt = new Date("2026-08-16T08:15:00.000Z");
  const observationInput = {
    envelope: {
      organizationId: organizationA.id,
      marketplaceId,
      type: "KEYWORD" as const,
      providerKey: "MOCK_RESEARCH",
      operation: "keywordMetrics",
      observationKey: `keyword:${keyword.id}:2026-08-16`,
      providerReference: `fixture-${suffix}`,
      observedAt,
      expiresAt: new Date("2026-08-17T08:15:00.000Z"),
      freshnessState: "FRESH" as const,
      completeness: "COMPLETE" as const,
      status: "SUCCESS" as const,
      requestHash: `request-${suffix}`,
      requestInputs: { keyword: "dog beds" },
      rawEvidenceReference: `private/research/${suffix}`,
    },
    keywordId: keyword.id,
    searchVolume: "1234.0000",
    competingProductCount: "345",
    suggestedBid: "1.2500",
    currency: "USD",
  };
  const firstObservation =
    await repository.appendKeywordObservation(observationInput);
  const retriedObservation =
    await repository.appendKeywordObservation(observationInput);
  assert.equal(retriedObservation.id, firstObservation.id);
  await assert.rejects(
    repository.appendKeywordObservation({
      ...observationInput,
      envelope: {
        ...observationInput.envelope,
        requestHash: `different-${suffix}`,
      },
    }),
    /OBSERVATION_IDEMPOTENCY_CONFLICT/,
  );
  assert.equal(
    await db.researchObservation.count({
      where: { organizationId: organizationA.id },
    }),
    1,
  );
  assert.equal(
    await db.keywordObservation.count({
      where: { organizationId: organizationA.id },
    }),
    1,
  );

  await assert.rejects(
    repository.appendKeywordObservation({
      ...observationInput,
      envelope: {
        ...observationInput.envelope,
        organizationId: organizationB.id,
        observationKey: `cross-tenant-${suffix}`,
      },
    }),
    /KEYWORD_NOT_FOUND/,
  );

  const series = await repository.createHistoricalMetricSeries({
    organizationId: organizationA.id,
    marketplaceId,
    subjectType: "KEYWORD",
    subjectKey: keyword.id,
    keywordId: keyword.id,
    metricKey: "search_volume",
    providerKey: "MOCK_RESEARCH",
    unit: "COUNT",
    retentionDays: 365,
  });
  const pointInput = {
    organizationId: organizationA.id,
    seriesId: series.id,
    sourceObservationId: firstObservation.id,
    metricAt: observedAt,
    value: { decimalValue: "1234.0000000000" },
  } as const;
  const point = await repository.appendHistoricalMetricPoint(pointInput);
  const retriedPoint = await repository.appendHistoricalMetricPoint(pointInput);
  assert.equal(retriedPoint.id, point.id);
  await assert.rejects(
    repository.appendHistoricalMetricPoint({
      ...pointInput,
      value: { decimalValue: "9999.0000000000" },
    }),
    /HISTORICAL_POINT_IDEMPOTENCY_CONFLICT/,
  );

  const assessment = await repository.recordOpportunityAssessment({
    organizationId: organizationA.id,
    projectId: project.id,
    projectItemId: projectItem.id,
    catalogProductId: catalogProduct.id,
    marketplaceId,
    status: "COMPLETE",
    recommendation: "WATCH",
    score: "72.5000",
    calculationVersion: "research-opportunity/v1",
    inputObservationReferences: [
      { observationId: firstObservation.id, purpose: "keyword demand" },
    ],
    calculatedAt: new Date("2026-08-16T08:20:00.000Z"),
    reasons: [
      {
        code: "DEMAND_OBSERVED",
        kind: "POSITIVE",
        message: "Licensed fixture returned keyword demand.",
        weight: "1.0000",
        evidenceRefs: [
          { observationId: firstObservation.id, purpose: "keyword demand" },
        ],
      },
    ],
  });
  assert.equal(assessment.calculationVersion, "research-opportunity/v1");
  assert.equal(assessment.reasons.length, 1);
  const rawAfterAssessment = await db.researchObservation.findUniqueOrThrow({
    where: { id: firstObservation.id },
  });
  assert.equal(rawAfterAssessment.requestHash, `request-${suffix}`);
  assert.equal(await repository.getProject(organizationB.id, project.id), null);

  console.log(
    JSON.stringify({
      projectModes: [project.mode, wholesaleProject.mode],
      tenantIsolation: "PASS",
      observationIdempotency: "PASS",
      derivedRawSeparation: "PASS",
    }),
  );
} finally {
  const organizationIds = organizations.map(({ id }) => id);
  await db.alertEvent.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await db.alertRule.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await db.opportunityReason.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await db.opportunityAssessment.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await db.historicalMetricPoint.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await db.historicalMetricSeries.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await db.keywordObservation.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await db.researchObservation.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await db.researchNote.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await db.researchProjectItem.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await db.researchProjectTag.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await db.researchTag.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await db.productWatch.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await db.marketMember.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await db.marketDefinition.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await db.keyword.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await db.researchProject.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await db.organization.deleteMany({ where: { id: { in: organizationIds } } });
  if (catalogProductId)
    await db.catalogProduct.delete({ where: { id: catalogProductId } });
  await db.$disconnect();
}
