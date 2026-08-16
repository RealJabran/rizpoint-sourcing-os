import assert from "node:assert/strict";
import {
  cleanupAnalysisScaleFixture,
  createAnalysisScaleFixture,
} from "./analysis-scale.fixture.js";
import { db, listAnalysisResults } from "../../packages/database/src/index.js";
import {
  getObjectMetadata,
  putPrivateObject,
} from "../../packages/object-storage/src/index.js";

let interruptedScanJobId: string | undefined;
await assert.rejects(
  () =>
    createAnalysisScaleFixture([1], {
      beforeCreateRows: (fixture) => {
        interruptedScanJobId = fixture.scans[0]?.scanJobId;
        throw new Error("analysis_scale_fixture_interrupted");
      },
    }),
  /analysis_scale_fixture_interrupted/,
);
assert.ok(interruptedScanJobId);
assert.equal(
  await db.scanJob.count({ where: { id: interruptedScanJobId } }),
  0,
);
console.log("analysis scale interrupted fixture cleanup completed");

const fixture = await createAnalysisScaleFixture();
let cleaned = false;

try {
  for (const scan of fixture.scans) {
    const startedAt = performance.now();
    const result = await listAnalysisResults({
      organizationId: fixture.organizationId,
      scanJobId: scan.scanJobId,
      shippingRouteId: scan.shippingRouteId,
      offset: scan.rowCount - 100,
      limit: 100,
      filters: { recommendation: "BUY" },
      sort: "sourceRowNumber",
      direction: "asc",
    });
    const elapsedMs = Math.round(performance.now() - startedAt);
    assert.equal(result?.total, scan.rowCount);
    assert.equal(result?.rows.length, 100);
    assert.equal(
      result?.rows[0]?.supplierRow.sourceRowNumber,
      scan.rowCount - 98,
    );
    console.log(`analysis scale ${scan.rowCount} rows: ${elapsedMs}ms`);
  }
  const cleanupScan = fixture.scans[0];
  assert.ok(cleanupScan);
  const objectKey = `exports/${fixture.organizationId}/scale-cleanup/${cleanupScan.scanJobId}.csv`;
  const exportJob = await db.exportJob.create({
    data: {
      organizationId: fixture.organizationId,
      scanJobId: cleanupScan.scanJobId,
      kind: "ANALYSIS_VIEW",
      format: "CSV",
      status: "COMPLETED",
      sourceRevision: 0,
      queryState: {},
      idempotencyKey: `analysis-scale-cleanup-${cleanupScan.scanJobId}`,
      objectKey,
      filename: "analysis-scale-cleanup.csv",
      contentType: "text/csv; charset=utf-8",
      checksumSha256: "scale-cleanup",
      byteSize: 1,
      generatorVersion: "test",
      completedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  await putPrivateObject({
    objectKey,
    body: new TextEncoder().encode("x"),
    contentType: "text/csv; charset=utf-8",
    contentDisposition: "attachment; filename=analysis-scale-cleanup.csv",
  });
  await cleanupAnalysisScaleFixture(fixture);
  cleaned = true;
  assert.equal(
    await db.exportJob.findUnique({ where: { id: exportJob.id } }),
    null,
  );
  await assert.rejects(() => getObjectMetadata(objectKey));
  console.log("analysis scale private export cleanup completed");
} finally {
  if (!cleaned) await cleanupAnalysisScaleFixture(fixture);
  await db.$disconnect();
}
