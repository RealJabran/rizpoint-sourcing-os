import { randomUUID } from "node:crypto";
import {
  db,
  ensurePhaseZeroOrganization,
} from "../../packages/database/src/index.js";
import { deletePrivateObject } from "../../packages/object-storage/src/index.js";

export const analysisScaleSizes = [5_000, 20_000, 50_000] as const;
const configuredScaleExportCleanupTimeoutMs = Number.parseInt(
  process.env.RIZPOINT_SCALE_EXPORT_CLEANUP_TIMEOUT_MS ?? "180000",
  10,
);
const scaleExportCleanupTimeoutMs =
  Number.isFinite(configuredScaleExportCleanupTimeoutMs) &&
  configuredScaleExportCleanupTimeoutMs >= 1_000
    ? configuredScaleExportCleanupTimeoutMs
    : 180_000;

export type AnalysisScaleFixture = {
  organizationId: string;
  supplierId: string;
  shippingRouteId: string;
  financialPolicyId: string;
  createdFinancialPolicy: boolean;
  uploadIds: string[];
  scans: Array<{
    rowCount: number;
    scanJobId: string;
    uploadId: string;
    shippingRouteId: string;
  }>;
};

export type AnalysisScaleFixtureOptions = {
  /** Test-only hook for proving cleanup after a partially created scan. */
  beforeCreateRows?: (fixture: AnalysisScaleFixture) => void | Promise<void>;
};

async function createRows(input: {
  scanJobId: string;
  uploadSheetId: string;
  calculationRunId: string;
  shippingRouteId: string;
  count: number;
  suffix: string;
  organizationId: string;
}) {
  const batchSize = 1_000;
  for (let start = 0; start < input.count; start += batchSize) {
    const end = Math.min(start + batchSize, input.count);
    const rows = Array.from({ length: end - start }, (_, offset) => {
      const rowNumber = start + offset + 2;
      return {
        id: `scale-row-${input.suffix}-${input.count}-${rowNumber}`,
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
        id: `scale-result-${input.suffix}-${input.count}-${row.sourceRowNumber}`,
        organizationId: input.organizationId,
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

export async function createAnalysisScaleFixture(
  sizes: readonly number[] = analysisScaleSizes,
  options: AnalysisScaleFixtureOptions = {},
): Promise<AnalysisScaleFixture> {
  const suffix = randomUUID();
  // The local browser fixture operates through the explicit demo boundary,
  // which is intentionally scoped to this one organization. It creates only
  // uniquely named disposable children and never mutates existing demo data.
  const organization = await ensurePhaseZeroOrganization();
  let createdFinancialPolicy = false;
  let financialPolicy = await db.financialPolicy.findUnique({
    where: { organizationId: organization.id },
  });
  if (!financialPolicy) {
    financialPolicy = await db.financialPolicy.create({
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
    createdFinancialPolicy = true;
  }
  const fixture: AnalysisScaleFixture = {
    organizationId: organization.id,
    supplierId: "",
    shippingRouteId: "",
    financialPolicyId: financialPolicy.id,
    createdFinancialPolicy,
    uploadIds: [],
    scans: [],
  };
  try {
    const supplier = await db.supplier.create({
      data: {
        organizationId: organization.id,
        code: `SCALE-${suffix}`,
        name: "Analysis scale supplier",
      },
    });
    fixture.supplierId = supplier.id;
    const route = await db.shippingRoute.create({
      data: {
        organizationId: organization.id,
        name: `Scale route ${suffix}`,
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
    fixture.shippingRouteId = route.id;
    for (const rowCount of sizes) {
      const upload = await db.upload.create({
        data: {
          organizationId: organization.id,
          supplierId: supplier.id,
          originalFilename: `analysis-scale-${rowCount}.csv`,
          objectKey: `integration/${suffix}/${rowCount}`,
          status: "COMPLETED",
          malwareStatus: "CLEAN",
        },
      });
      // Track each disposable parent as soon as it exists. If a bulk insert is
      // interrupted, cleanup can still remove its scan tree rather than leaving
      // a route/supplier collision for the next scale run.
      fixture.uploadIds.push(upload.id);
      const sheet = await db.uploadSheet.create({
        data: {
          uploadId: upload.id,
          sheetIndex: 0,
          name: "Sheet1",
          rowCount: rowCount + 1,
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
          idempotencyKey: `analysis-scale-${suffix}-${rowCount}`,
          jobType: "CATALOG_IMPORT",
          status: "COMPLETED",
          checkpoints: {
            create: {
              stage: "CALCULATE",
              checksum: `analysis-scale-${suffix}-${rowCount}`,
            },
          },
        },
      });
      fixture.scans.push({
        rowCount,
        scanJobId: scan.id,
        uploadId: upload.id,
        shippingRouteId: route.id,
      });
      const calculation = await db.profitCalculationRun.create({
        data: {
          organizationId: organization.id,
          scanJobId: scan.id,
          financialPolicyId: financialPolicy.id,
          idempotencyKey: `analysis-scale-calculation-${suffix}-${rowCount}`,
          status: "COMPLETED",
        },
      });
      await options.beforeCreateRows?.(fixture);
      await createRows({
        scanJobId: scan.id,
        uploadSheetId: sheet.id,
        calculationRunId: calculation.id,
        shippingRouteId: route.id,
        count: rowCount,
        suffix,
        organizationId: organization.id,
      });
    }
    return fixture;
  } catch (error) {
    await cleanupAnalysisScaleFixture(fixture);
    throw error;
  }
}

async function waitForFixtureExportsToSettle(
  fixture: AnalysisScaleFixture,
  scanJobIds: string[],
): Promise<Array<{ id: string; objectKey: string | null }>> {
  const deadline = Date.now() + scaleExportCleanupTimeoutMs;
  for (;;) {
    const exports = await db.exportJob.findMany({
      where: {
        organizationId: fixture.organizationId,
        scanJobId: { in: scanJobIds },
      },
      select: { id: true, status: true, objectKey: true },
    });
    const unfinished = exports.filter(
      (item) =>
        item.status === "PENDING" ||
        item.status === "RUNNING" ||
        item.status === "FAILED_RETRYABLE",
    );
    if (!unfinished.length)
      return exports.map(({ id, objectKey }) => ({ id, objectKey }));
    if (Date.now() >= deadline)
      throw new Error("analysis_scale_fixture_export_cleanup_timeout");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/**
 * Explicit child cleanup keeps disposable large fixtures bounded. Export rows
 * are deleted only after their worker job is terminal and their private object
 * is removed, so a failed scale run cannot race an in-flight export into an
 * orphaned object or a noisy worker update failure.
 */
export async function cleanupAnalysisScaleFixture(
  fixture: AnalysisScaleFixture,
): Promise<void> {
  const scanJobIds = fixture.scans.map((scan) => scan.scanJobId);
  const uploadIds = fixture.uploadIds;
  if (scanJobIds.length) {
    const exportJobs = await waitForFixtureExportsToSettle(fixture, scanJobIds);
    for (const exportJob of exportJobs)
      if (exportJob.objectKey) await deletePrivateObject(exportJob.objectKey);
    const exportJobIds = exportJobs.map((exportJob) => exportJob.id);
    await db.outboxEvent.deleteMany({
      where: {
        organizationId: fixture.organizationId,
        OR: [
          { scanJobId: { in: scanJobIds } },
          ...(exportJobIds.length
            ? [{ exportJobId: { in: exportJobIds } }]
            : []),
        ],
      },
    });
    await db.workflowAuditEvent.deleteMany({
      where: {
        organizationId: fixture.organizationId,
        entityId: { in: [...scanJobIds, ...exportJobIds] },
      },
    });
    await db.exportJob.deleteMany({
      where: {
        organizationId: fixture.organizationId,
        scanJobId: { in: scanJobIds },
      },
    });
    await db.profitResult.deleteMany({
      where: {
        organizationId: fixture.organizationId,
        scanJobId: { in: scanJobIds },
      },
    });
    await db.supplierRow.deleteMany({
      where: { scanJobId: { in: scanJobIds } },
    });
    await db.profitCalculationRun.deleteMany({
      where: {
        organizationId: fixture.organizationId,
        scanJobId: { in: scanJobIds },
      },
    });
    await db.scanJob.deleteMany({ where: { id: { in: scanJobIds } } });
    await db.upload.deleteMany({ where: { id: { in: uploadIds } } });
  }
  if (fixture.supplierId)
    await db.supplier.delete({ where: { id: fixture.supplierId } });
  if (fixture.shippingRouteId)
    await db.shippingRoute.delete({ where: { id: fixture.shippingRouteId } });
  if (fixture.createdFinancialPolicy)
    await db.financialPolicy.delete({
      where: { id: fixture.financialPolicyId },
    });
  if (scanJobIds.length) {
    const remaining = await db.scanJob.count({
      where: { id: { in: scanJobIds } },
    });
    if (remaining) throw new Error("analysis_scale_fixture_cleanup_incomplete");
  }
}
