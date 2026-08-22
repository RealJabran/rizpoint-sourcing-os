import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  claimProductResearchRun,
  completeProductResearchRun,
  db,
  getProductResearchRun,
  queueProductResearchRun,
} from "../../packages/database/src/index.js";

process.env.PHASE_ZERO_DEMO_MODE = "true";
process.env.PROVIDER_MODE = "mock";

const suffix = randomUUID();
const marketplaceId = "ATVPDKIKX0DER";
const organizations = await Promise.all([
  db.organization.create({
    data: { slug: `product-research-a-${suffix}`, name: "Product research A" },
  }),
  db.organization.create({
    data: { slug: `product-research-b-${suffix}`, name: "Product research B" },
  }),
]);
const organizationA = organizations[0]!;
const organizationB = organizations[1]!;
let productId: string | undefined;

try {
  const first = await queueProductResearchRun({
    organizationId: organizationA.id,
    marketplaceId,
    kind: "PRODUCT_LOOKUP",
    queryType: "ASIN",
    queryText: "B000000001",
    idempotencyKey: `research-${suffix}`,
  });
  assert.equal(first.duplicate, false);
  const duplicate = await queueProductResearchRun({
    organizationId: organizationA.id,
    marketplaceId,
    kind: "PRODUCT_LOOKUP",
    queryType: "ASIN",
    queryText: "B000000001",
    idempotencyKey: `research-${suffix}`,
  });
  assert.equal(duplicate.id, first.id);
  assert.equal(duplicate.duplicate, true);
  assert.equal(
    await getProductResearchRun({
      organizationId: organizationB.id,
      runId: first.id,
    }),
    null,
  );
  const claimed = await claimProductResearchRun(first.id);
  assert.equal(claimed?.status, "RUNNING");
  await completeProductResearchRun({
    runId: first.id,
    organizationId: organizationA.id,
    items: [
      {
        product: {
          asin: "B000000001",
          title: "Stored manual research product",
          brand: "Fixture Brand",
          identifiers: [
            { type: "ASIN", value: "B000000001" },
            { type: "UPC", value: "012345678905" },
          ],
          images: [{ url: "https://images.example.test/product.jpg" }],
          salesRanks: [{ classificationId: "home", rank: 42 }],
          provenance: {
            provider: `recorded-product-research-${suffix}`,
            dataOrigin: "MOCK",
            providerReference: `product-${suffix}`,
            marketplaceId,
            observedAt: "2026-08-22T10:00:00.000Z",
            freshnessState: "FRESH",
            responseCompleteness: "COMPLETE",
          },
          rawProviderObservation: { privatePayload: "must-not-cross-browser" },
        },
        evidence: {
          catalog: { status: "AVAILABLE" },
          pricing: { status: "UNAVAILABLE", reason: "FIXTURE_BOUNDARY" },
        },
        source: "Recorded demo fixture",
        dataOrigin: "MOCK",
        observedAt: new Date("2026-08-22T10:00:00.000Z"),
        freshUntil: new Date("2026-08-23T10:00:00.000Z"),
        freshnessState: "FRESH",
        completeness: "PARTIAL",
        status: "PARTIAL_SUCCESS",
      },
    ],
  });
  const stored = await getProductResearchRun({
    organizationId: organizationA.id,
    runId: first.id,
  });
  assert.equal(stored?.status, "PARTIAL_SUCCESS");
  assert.equal(stored?.items[0]?.product.asin, "B000000001");
  assert.equal(stored?.items[0]?.dataOrigin, "MOCK");
  assert.equal(stored?.items[0]?.freshnessState, "FRESH");
  assert.doesNotMatch(
    JSON.stringify(stored),
    /must-not-cross-browser|rawProviderObservation|privatePayload/,
  );
  productId = stored?.items[0]?.product.id;
  assert.equal(
    await db.outboxEvent.count({
      where: { productResearchRunId: first.id },
    }),
    1,
  );
  console.log(
    JSON.stringify({
      durableResearchRun: "PASS",
      tenantIsolation: "PASS",
      idempotency: "PASS",
      sanitizedProjection: "PASS",
    }),
  );
} finally {
  const ids = organizations.map((organization) => organization.id);
  await db.outboxEvent.deleteMany({ where: { organizationId: { in: ids } } });
  await db.productResearchRunItem.deleteMany({
    where: { organizationId: { in: ids } },
  });
  await db.productResearchRun.deleteMany({
    where: { organizationId: { in: ids } },
  });
  await db.providerRequestAttempt.deleteMany({
    where: { organizationId: { in: ids } },
  });
  await db.providerRequestLease.deleteMany({
    where: { organizationId: { in: ids } },
  });
  await db.providerCacheEntry.deleteMany({
    where: { organizationId: { in: ids } },
  });
  await db.researchObservation.deleteMany({
    where: { organizationId: { in: ids } },
  });
  await db.providerBudgetReservation.deleteMany({
    where: { organizationId: { in: ids } },
  });
  await db.providerRateBudget.deleteMany({
    where: { organizationId: { in: ids } },
  });
  await db.workflowAuditEvent.deleteMany({
    where: { organizationId: { in: ids } },
  });
  await db.providerEntitlement.deleteMany({
    where: { organizationId: { in: ids } },
  });
  await db.providerConnectionMarketplace.deleteMany({
    where: { organizationId: { in: ids } },
  });
  await db.providerConnection.deleteMany({
    where: { organizationId: { in: ids } },
  });
  await db.organization.deleteMany({ where: { id: { in: ids } } });
  if (productId)
    await db.catalogProduct.deleteMany({ where: { id: productId } });
  await db.$disconnect();
}
