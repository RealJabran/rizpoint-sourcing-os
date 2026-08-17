import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createResearchRepository,
  db,
  listProductExplorer,
} from "../../packages/database/src/index.js";

const suffix = randomUUID();
const marketplaceId = "ATVPDKIKX0DER";
const [organizationA, organizationB] = await Promise.all([
  db.organization.create({
    data: { slug: `explorer-a-${suffix}`, name: "Explorer A" },
  }),
  db.organization.create({
    data: { slug: `explorer-b-${suffix}`, name: "Explorer B" },
  }),
]);
const repository = createResearchRepository();
let productId: string | undefined;

try {
  const product = await db.catalogProduct.create({
    data: {
      provider: "MOCK_AMAZON",
      providerReference: `explorer-${suffix}`,
      asin: "B000000001",
      title: "Stable low review fixture",
      brand: "Fixture Brand",
      marketplaceId,
      identityProjection: { productTypes: ["PET_SUPPLIES"] },
      observedAt: new Date("2026-08-17T00:00:00.000Z"),
      freshnessState: "FRESH",
    },
  });
  productId = product.id;
  const project = await repository.createProject({
    organizationId: organizationA.id,
    name: "Explorer fixture",
    mode: "PRIVATE_LABEL",
    marketplaceId,
  });
  await repository.addProjectItem({
    organizationId: organizationA.id,
    projectId: project.id,
    kind: "PRODUCT",
    catalogProductId: product.id,
    subjectKey: product.id,
  });
  await db.historyAnalyticsAssessment.create({
    data: {
      organizationId: organizationA.id,
      catalogProductId: product.id,
      marketplaceId,
      providerKey: "RECORDED_HISTORY",
      calculationVersion: "history-analytics/v1",
      inputFingerprint: suffix,
      status: "COMPLETE",
      windowEnd: new Date("2026-08-17T00:00:00.000Z"),
      coveragePercent: "80.0000",
      metrics: {
        price: { "90": { volatilityPercent: "10.0000" } },
        reviewCountGrowth: { "90": { growth: "5.0000" } },
        estimatedListingAgeDays: "120.0000",
        seasonalIndex: { status: "PARTIAL" },
      },
      warnings: [],
      inputPointReferences: [],
      calculatedAt: new Date("2026-08-17T00:00:00.000Z"),
    },
  });
  const result = await listProductExplorer({
    organizationId: organizationA.id,
    offset: 0,
    limit: 100,
    filters: { marketplaceId, maxPriceVolatilityPercent: "15" },
  });
  assert.equal(result.total, 1);
  assert.equal(result.rows[0]?.asin, "B000000001");
  assert.deepEqual(result.rows[0]?.sources, ["PROJECT"]);
  assert.equal(result.rows[0]?.priceVolatilityPercent, "10");
  assert.equal(
    (
      await listProductExplorer({
        organizationId: organizationB.id,
        offset: 0,
        limit: 100,
        filters: {},
      })
    ).total,
    0,
  );
  const watch = await repository.createProductWatch({
    organizationId: organizationA.id,
    projectId: project.id,
    catalogProductId: product.id,
    marketplaceId,
  });
  assert.equal(watch.status, "ACTIVE");
  console.log(
    JSON.stringify({
      tenantUniverse: "PASS",
      filters: "PASS",
      projectSave: "PASS",
      watch: "PASS",
    }),
  );
} finally {
  const orgIds = [organizationA.id, organizationB.id];
  await db.historyAnalyticsAssessment.deleteMany({
    where: { organizationId: { in: orgIds } },
  });
  await db.productWatch.deleteMany({
    where: { organizationId: { in: orgIds } },
  });
  await db.researchProjectItem.deleteMany({
    where: { organizationId: { in: orgIds } },
  });
  await db.researchProject.deleteMany({
    where: { organizationId: { in: orgIds } },
  });
  await db.organization.deleteMany({ where: { id: { in: orgIds } } });
  if (productId) await db.catalogProduct.delete({ where: { id: productId } });
  await db.$disconnect();
}
