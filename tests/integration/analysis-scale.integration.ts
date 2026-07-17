import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, listAnalysisResults } from "../../packages/database/src/index.js";

const sizes = [5_000, 20_000, 50_000] as const;
const suffix = randomUUID();
const organization = await db.organization.create({
  data: { slug: `analysis-scale-${suffix}`, name: "Analysis scale fixture" },
});

async function createRows(input: {
  scanJobId: string;
  uploadSheetId: string;
  calculationRunId: string;
  shippingRouteId: string;
  count: number;
}) {
  const batchSize = 1_000;
  for (let start = 0; start < input.count; start += batchSize) {
    const end = Math.min(start + batchSize, input.count);
    const rows = Array.from({ length: end - start }, (_, offset) => {
      const rowNumber = start + offset + 2;
      return {
        id: `scale-row-${suffix}-${input.count}-${rowNumber}`,
        scanJobId: input.scanJobId,
        uploadSheetId: input.uploadSheetId,
        sourceRowNumber: rowNumber,
        rawData: { supplier_sku: `SCALE-${rowNumber}` },
        rowChecksum: `scale-${input.count}-${rowNumber}`,
        normalizationStatus: "NORMALIZED" as const,
      };
    });
    await db.supplierRow.createMany({ data: rows });
    await db.profitResult.createMany({
      data: rows.map((row) => ({
        id: `scale-result-${suffix}-${input.count}-${row.sourceRowNumber}`,
        organizationId: organization.id,
        scanJobId: input.scanJobId,
        profitCalculationRunId: input.calculationRunId,
        supplierRowId: row.id,
        shippingRouteId: input.shippingRouteId,
        status: "COMPLETED" as const,
        recommendation: "BUY" as const,
        currentNetProfit: "4.0000",
        currentProceeds: "20.0000",
        conservativeNetProfit: "3.0000",
        effectiveCogs: "10.0000",
        amazonFees: "6.0000",
        roiPercent: "40.0000",
        marginPercent: "20.0000",
        engineVersion: "profit-engine/v3",
        inputSnapshot: { fixture: "analysis-scale" },
        evidence: { fixture: "analysis-scale" },
        reasonCodes: [],
      })),
    });
  }
}

try {
  const supplier = await db.supplier.create({
    data: {
      organizationId: organization.id,
      code: `SCALE-${suffix}`,
      name: "Analysis scale supplier",
    },
  });
  const policy = await db.financialPolicy.create({
    data: {
      organizationId: organization.id,
      currency: "USD",
      engineVersion: "profit-engine/v3",
      minNetProfit: "3.0000",
      minRoiPercent: "30.0000",
      minMarginPercent: "10.0000",
      maxStressLoss: "0.0000",
      stressDiscountPercent: "10.0000",
    },
  });
  const route = await db.shippingRoute.create({
    data: {
      organizationId: organization.id,
      name: "Scale route",
      currency: "USD",
      effectiveFrom: new Date("2026-07-18T00:00:00.000Z"),
      allocatedSupplierFreight: "0",
      prepFee: "0",
      labelingFee: "0",
      polybagFee: "0",
      bundleFee: "0",
      bubblewrapFee: "0",
      inboundShipping: "0",
      dutyOrTax: "0",
      storageAllowance: "0",
      returnAllowance: "0",
      otherCosts: "0",
    },
  });

  for (const count of sizes) {
    const upload = await db.upload.create({
      data: {
        organizationId: organization.id,
        supplierId: supplier.id,
        originalFilename: `analysis-scale-${count}.csv`,
        objectKey: `integration/${suffix}/${count}`,
        status: "COMPLETED",
        malwareStatus: "CLEAN",
      },
    });
    const sheet = await db.uploadSheet.create({
      data: {
        uploadId: upload.id,
        sheetIndex: 0,
        name: "Sheet1",
        rowCount: count + 1,
        columnCount: 1,
        headerCandidates: [],
        columns: [],
        preview: [],
      },
    });
    const scan = await db.scanJob.create({
      data: {
        organizationId: organization.id,
        supplierId: supplier.id,
        uploadId: upload.id,
        idempotencyKey: `analysis-scale-${suffix}-${count}`,
        jobType: "CATALOG_IMPORT",
        status: "COMPLETED",
      },
    });
    const calculation = await db.profitCalculationRun.create({
      data: {
        organizationId: organization.id,
        scanJobId: scan.id,
        financialPolicyId: policy.id,
        idempotencyKey: `analysis-scale-calculation-${suffix}-${count}`,
        status: "COMPLETED",
      },
    });
    await createRows({
      scanJobId: scan.id,
      uploadSheetId: sheet.id,
      calculationRunId: calculation.id,
      shippingRouteId: route.id,
      count,
    });
    const startedAt = performance.now();
    const result = await listAnalysisResults({
      organizationId: organization.id,
      scanJobId: scan.id,
      shippingRouteId: route.id,
      offset: count - 100,
      limit: 100,
      filters: { recommendation: "BUY" },
      sort: "sourceRowNumber",
      direction: "asc",
    });
    const elapsedMs = Math.round(performance.now() - startedAt);
    assert.equal(result?.total, count);
    assert.equal(result?.rows.length, 100);
    assert.equal(result?.rows[0]?.supplierRow.sourceRowNumber, count - 98);
    console.log(`analysis scale ${count} rows: ${elapsedMs}ms`);
  }
} finally {
  // Remove large child sets explicitly before deleting scans. This avoids
  // database-side cascade work across unrelated child tables and keeps this
  // disposable scale fixture bounded on developer machines.
  await db.profitResult.deleteMany({
    where: { organizationId: organization.id },
  });
  await db.supplierRow.deleteMany({
    where: {
      scanJob: { organizationId: organization.id },
    },
  });
  await db.profitCalculationRun.deleteMany({
    where: { organizationId: organization.id },
  });
  await db.scanJob.deleteMany({ where: { organizationId: organization.id } });
  await db.upload.deleteMany({ where: { organizationId: organization.id } });
  await db.supplier.deleteMany({ where: { organizationId: organization.id } });
  await db.shippingRoute.deleteMany({
    where: { organizationId: organization.id },
  });
  await db.financialPolicy.deleteMany({
    where: { organizationId: organization.id },
  });
  await db.organization.delete({ where: { id: organization.id } });
  await db.$disconnect();
}
