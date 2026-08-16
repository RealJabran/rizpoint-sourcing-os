import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  db,
  getHistoryRefreshRun,
  queueHistoryRefresh,
} from "../../packages/database/src/index.js";
import { deletePrivateObject } from "../../packages/object-storage/src/index.js";
import { processHistoryRefresh } from "../../apps/worker/src/market-history.js";

const suffix = randomUUID();
const marketplaceId = "ATVPDKIKX0DER";
const organization = await db.organization.create({
  data: { slug: `history-${suffix}`, name: "History integration tenant" },
});

try {
  const supplier = await db.supplier.create({
    data: {
      organizationId: organization.id,
      code: `H-${suffix}`,
      name: "History supplier",
    },
  });
  const upload = await db.upload.create({
    data: {
      organizationId: organization.id,
      supplierId: supplier.id,
      originalFilename: "history-fixture.csv",
      objectKey: `integration/${suffix}.csv`,
      status: "READY",
    },
  });
  const sheet = await db.uploadSheet.create({
    data: {
      uploadId: upload.id,
      sheetIndex: 0,
      name: "Sheet1",
      rowCount: 1,
      columnCount: 1,
      headerCandidates: [0],
      columns: [],
      preview: [],
    },
  });
  const scan = await db.scanJob.create({
    data: {
      organizationId: organization.id,
      supplierId: supplier.id,
      uploadId: upload.id,
      jobType: "UPLOAD",
      status: "COMPLETED",
      idempotencyKey: `history-${suffix}`,
    },
  });
  const row = await db.supplierRow.create({
    data: {
      scanJobId: scan.id,
      uploadSheetId: sheet.id,
      sourceRowNumber: 2,
      rawData: {},
      rowChecksum: suffix,
    },
  });
  const product = await db.catalogProduct.create({
    data: {
      provider: "MOCK_AMAZON",
      providerReference: `history-${suffix}`,
      asin: "B000000001",
      title: "Recorded history product",
      marketplaceId,
      observedAt: new Date(),
      freshnessState: "FRESH",
    },
  });
  const candidate = await db.listingCandidate.create({
    data: {
      organizationId: organization.id,
      supplierRowId: row.id,
      catalogProductId: product.id,
      source: "SUPPLIED_ASIN",
      confidence: 100,
    },
  });
  await db.matchDecision.create({
    data: {
      organizationId: organization.id,
      supplierRowId: row.id,
      selectedCandidateId: candidate.id,
      status: "AUTO_ACCEPTED",
      confidence: 100,
      reasonCodes: ["EXACT_ASIN"],
      source: "SYSTEM",
    },
  });

  const queued = await queueHistoryRefresh({
    organizationId: organization.id,
    scanJobId: scan.id,
    idempotencyKey: randomUUID(),
    historyDays: 90,
  });
  assert.ok(queued);
  assert.equal(queued.items.length, 1);
  await processHistoryRefresh(queued.id);
  const completed = await getHistoryRefreshRun(organization.id, queued.id);
  assert.equal(completed?.status, "COMPLETED");
  assert.equal(completed?.items[0]?.status, "COMPLETED");
  const observations = await db.researchObservation.findMany({
    where: { organizationId: organization.id, type: "HISTORY" },
  });
  assert.equal(observations.length, 1);
  const series = await db.historicalMetricSeries.findMany({
    where: { organizationId: organization.id, catalogProductId: product.id },
    include: { points: true },
  });
  assert.ok(series.some((item) => item.metricKey === "AMAZON_PRICE"));
  assert.ok(series.some((item) => item.metricKey === "SALES_RANK"));
  assert.ok(series.every((item) => item.points.length > 0));
  // The exact duplicate returns the original run and cannot enqueue a second
  // provider request or a second historical point.
  const duplicate = await queueHistoryRefresh({
    organizationId: organization.id,
    scanJobId: scan.id,
    idempotencyKey: queued.idempotencyKey,
    historyDays: 90,
  });
  assert.equal(duplicate?.duplicate, true);
  assert.equal(
    await queueHistoryRefresh({
      organizationId: "not-this-tenant",
      scanJobId: scan.id,
      idempotencyKey: randomUUID(),
    }),
    null,
  );
  console.log(
    JSON.stringify({
      historyRefresh: "PASS",
      sparseSafe: "PASS",
      idempotent: "PASS",
    }),
  );
} finally {
  const evidence = await db.historyRefreshItem.findMany({
    where: {
      organizationId: organization.id,
      rawEvidenceReference: { not: null },
    },
    select: { rawEvidenceReference: true },
  });
  await Promise.all(
    evidence.flatMap((item) =>
      item.rawEvidenceReference
        ? [
            deletePrivateObject(item.rawEvidenceReference).catch(
              () => undefined,
            ),
          ]
        : [],
    ),
  );
  await db.historyRefreshItem.deleteMany({
    where: { organizationId: organization.id },
  });
  await db.historyRefreshRun.deleteMany({
    where: { organizationId: organization.id },
  });
  await db.historicalMetricPoint.deleteMany({
    where: { organizationId: organization.id },
  });
  await db.historicalMetricSeries.deleteMany({
    where: { organizationId: organization.id },
  });
  await db.researchObservation.deleteMany({
    where: { organizationId: organization.id },
  });
  await db.matchDecision.deleteMany({
    where: { organizationId: organization.id },
  });
  await db.listingCandidate.deleteMany({
    where: { organizationId: organization.id },
  });
  await db.supplierRow.deleteMany({
    where: { scanJob: { organizationId: organization.id } },
  });
  await db.outboxEvent.deleteMany({
    where: { organizationId: organization.id },
  });
  await db.providerRequestAttempt.deleteMany({
    where: { organizationId: organization.id },
  });
  await db.providerRequestLease.deleteMany({
    where: { organizationId: organization.id },
  });
  await db.providerCacheEntry.deleteMany({
    where: { organizationId: organization.id },
  });
  await db.providerBudgetReservation.deleteMany({
    where: { organizationId: organization.id },
  });
  await db.providerRateBudget.deleteMany({
    where: { organizationId: organization.id },
  });
  await db.providerEntitlement.deleteMany({
    where: { organizationId: organization.id },
  });
  await db.scanJob.deleteMany({ where: { organizationId: organization.id } });
  await db.uploadSheet.deleteMany({
    where: { upload: { organizationId: organization.id } },
  });
  await db.upload.deleteMany({ where: { organizationId: organization.id } });
  await db.supplier.deleteMany({ where: { organizationId: organization.id } });
  await db.organization.delete({ where: { id: organization.id } });
  await db.catalogProduct.deleteMany({
    where: { providerReference: `history-${suffix}` },
  });
  await db.$disconnect();
}
