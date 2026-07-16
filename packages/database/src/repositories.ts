import type {
  CostOverrideField,
  Prisma,
  ProductRecommendation,
  ScanJobStatus,
} from "./generated/prisma/client.js";
import { createHash, randomUUID } from "node:crypto";
import {
  assertPersistedOrderLine,
  sumOrderLines,
  type PersistedOrderLine,
} from "@rizpoint/order-engine";
import { db } from "./client.js";

export const PHASE_ZERO_ORGANIZATION_SLUG = "rizpoint-demo";
export const PRIVATE_ORGANIZATION_SLUG =
  process.env.RIZPOINT_PRIVATE_ORGANIZATION_SLUG ?? "rizpoint-private";

function requestFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function auditPayload(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function assertIdempotentEvent(
  event: {
    entityType: string;
    entityId: string;
    eventType: string;
    payload: unknown;
  },
  expected: {
    entityType: string;
    entityId: string;
    eventType: string;
    fingerprint: string;
  },
): void {
  if (
    event.entityType !== expected.entityType ||
    event.entityId !== expected.entityId ||
    event.eventType !== expected.eventType ||
    auditPayload(event.payload).fingerprint !== expected.fingerprint
  )
    throw new Error("IDEMPOTENCY_KEY_REUSED");
}

export async function ensurePhaseZeroOrganization() {
  if (process.env.PHASE_ZERO_DEMO_MODE !== "true") {
    const organization = await db.organization.findUnique({
      where: { slug: PRIVATE_ORGANIZATION_SLUG },
    });
    if (!organization) throw new Error("PRIVATE_ORGANIZATION_NOT_BOOTSTRAPPED");
    return organization;
  }
  const organization = await db.organization.upsert({
    where: { slug: PHASE_ZERO_ORGANIZATION_SLUG },
    create: {
      slug: PHASE_ZERO_ORGANIZATION_SLUG,
      name: "RizPoint Demo Organization",
    },
    update: {},
  });
  const supplier = await db.supplier.upsert({
    where: {
      organizationId_code: { organizationId: organization.id, code: "VSI" },
    },
    create: {
      organizationId: organization.id,
      code: "VSI",
      name: "VSI",
      isVsiPreset: true,
      orderingRulesSource: "DEMO_CONFIGURATION",
      orderingRulesObservedAt: new Date(),
    },
    update: {},
  });
  await db.supplier.updateMany({
    where: { id: supplier.id, orderingRulesObservedAt: null },
    data: {
      orderingRulesSource: "DEMO_CONFIGURATION",
      orderingRulesObservedAt: new Date(),
    },
  });
  await db.financialPolicy.upsert({
    where: { organizationId: organization.id },
    create: {
      organizationId: organization.id,
      currency: "USD",
      engineVersion: "profit-engine/v2",
      minNetProfit: "3.00",
      minRoiPercent: "30.00",
      minMarginPercent: "10.00",
      maxStressLoss: "0.00",
      stressDiscountPercent: "10.00",
      minimumDemandScore: 1,
    },
    update: {},
  });
  await db.shippingRoute.upsert({
    where: {
      organizationId_name_effectiveFrom: {
        organizationId: organization.id,
        name: "Local demo route",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      },
    },
    create: {
      organizationId: organization.id,
      name: "Local demo route",
      currency: "USD",
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      allocatedSupplierFreight: "0.50",
      prepFee: "1.49",
      labelingFee: "0.10",
      polybagFee: "0.00",
      bundleFee: "0.00",
      bubblewrapFee: "0.00",
      inboundShipping: "0.75",
      dutyOrTax: "0.00",
      storageAllowance: "0.20",
      returnAllowance: "0.30",
      otherCosts: "0.00",
    },
    update: {},
  });
  await db.brandPolicy.upsert({
    where: {
      organizationId_brand: { organizationId: organization.id, brand: "Acme" },
    },
    create: {
      organizationId: organization.id,
      brand: "Acme",
      status: "UNRESTRICTED",
    },
    update: {},
  });
  return organization;
}

export async function getSupplierForOrganization(
  organizationId: string,
  supplierId: string,
) {
  return db.supplier.findFirst({ where: { id: supplierId, organizationId } });
}

export async function createMockScanJob(
  organizationId: string,
  idempotencyKey: string,
) {
  return db.$transaction(async (transaction) => {
    const job = await transaction.scanJob.upsert({
      where: {
        organizationId_idempotencyKey: { organizationId, idempotencyKey },
      },
      create: { organizationId, idempotencyKey },
      update: {},
    });

    await transaction.outboxEvent.upsert({
      where: {
        scanJobId_eventType: {
          scanJobId: job.id,
          eventType: "mock.scan.requested",
        },
      },
      create: {
        organizationId,
        scanJobId: job.id,
        eventType: "mock.scan.requested",
        payload: { scanJobId: job.id },
      },
      update: {},
    });

    return job;
  });
}

export async function getScanJobForOrganization(
  organizationId: string,
  scanJobId: string,
) {
  return db.scanJob.findFirst({
    where: { id: scanJobId, organizationId },
    include: { checkpoints: true, events: { orderBy: { createdAt: "asc" } } },
  });
}

const DASHBOARD_PROCESSING_STATUSES: ScanJobStatus[] = [
  "QUEUED",
  "RUNNING",
  "NORMALIZING",
  "MATCHING",
  "ENRICHING",
  "CALCULATING",
];

const DASHBOARD_ATTENTION_STATUSES: ScanJobStatus[] = [
  "MAPPING_REQUIRED",
  "READY",
  "PARTIAL_SUCCESS",
  "FAILED_RETRYABLE",
  "FAILED_FINAL",
];

const scanSummarySelect = {
  id: true,
  jobType: true,
  status: true,
  attemptCount: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
  supplier: { select: { code: true, name: true } },
  upload: {
    select: {
      originalFilename: true,
      status: true,
      malwareStatus: true,
    },
  },
  _count: { select: { supplierRows: true } },
} satisfies Prisma.ScanJobSelect;

export async function listScanSummaries(organizationId: string, take = 25) {
  return db.scanJob.findMany({
    where: { organizationId },
    select: scanSummarySelect,
    orderBy: { updatedAt: "desc" },
    take,
  });
}

export async function getDashboardScanSummary(organizationId: string) {
  const [totalScans, processingScans, attentionScans, recentScans] =
    await db.$transaction([
      db.scanJob.count({ where: { organizationId } }),
      db.scanJob.count({
        where: {
          organizationId,
          status: { in: DASHBOARD_PROCESSING_STATUSES },
        },
      }),
      db.scanJob.count({
        where: {
          organizationId,
          status: { in: DASHBOARD_ATTENTION_STATUSES },
        },
      }),
      db.scanJob.findMany({
        where: { organizationId },
        select: scanSummarySelect,
        orderBy: { updatedAt: "desc" },
        take: 6,
      }),
    ]);
  return { totalScans, processingScans, attentionScans, recentScans };
}

export async function listSuppliers(organizationId: string) {
  return db.supplier.findMany({
    where: { organizationId },
    orderBy: { name: "asc" },
  });
}

export async function createSupplier(
  organizationId: string,
  code: string,
  name: string,
) {
  return db.supplier.upsert({
    where: { organizationId_code: { organizationId, code } },
    create: { organizationId, code, name, isVsiPreset: code === "VSI" },
    update: { name },
  });
}

export async function createUpload(
  organizationId: string,
  supplierId: string,
  originalFilename: string,
  declaredMediaType: string | null,
  idempotencyKey: string,
) {
  return db.$transaction(async (transaction) => {
    const supplier = await transaction.supplier.findFirst({
      where: { id: supplierId, organizationId },
    });
    if (!supplier) return null;
    const existing = await transaction.scanJob.findFirst({
      where: { organizationId, idempotencyKey, jobType: "UPLOAD" },
      include: { upload: true },
    });
    if (existing?.upload) return { upload: existing.upload, scan: existing };
    const uploadId = randomUUID();
    const upload = await transaction.upload.create({
      data: {
        id: uploadId,
        organizationId,
        supplierId,
        originalFilename,
        objectKey: `quarantine/${organizationId}/${uploadId}`,
        declaredMediaType,
      },
    });
    const scan = await transaction.scanJob.create({
      data: {
        organizationId,
        supplierId,
        uploadId,
        idempotencyKey,
        jobType: "UPLOAD",
        status: "UPLOADED",
      },
    });
    return { upload, scan };
  });
}

export async function getUploadForOrganization(
  organizationId: string,
  uploadId: string,
) {
  return db.upload.findFirst({
    where: { id: uploadId, organizationId },
    include: {
      sheets: { orderBy: { sheetIndex: "asc" } },
      scan: {
        include: {
          checkpoints: { orderBy: { createdAt: "asc" } },
          columnMappings: true,
          supplierRows: {
            orderBy: { sourceRowNumber: "asc" },
            include: { warnings: true },
          },
        },
      },
    },
  });
}

export async function queueUploadInspection(
  organizationId: string,
  uploadId: string,
  byteSize: number,
  checksumSha256: string,
) {
  return db.$transaction(async (transaction) => {
    const upload = await transaction.upload.findFirst({
      where: { id: uploadId, organizationId },
      include: { scan: true },
    });
    if (!upload?.scan) return null;
    const retryingFailedInspection =
      upload.status === "INSPECTING" && upload.scan.status === "FAILED_FINAL";
    if (upload.status === "INSPECTING" && !retryingFailedInspection)
      return upload.scan;
    if (upload.status !== "PENDING_UPLOAD" && !retryingFailedInspection)
      return null;
    await transaction.upload.update({
      where: { id: upload.id },
      data: {
        byteSize,
        checksumSha256,
        status: "INSPECTING",
        malwareStatus: "PENDING",
        rejectionCode: null,
      },
    });
    if (retryingFailedInspection) {
      await transaction.scanJob.update({
        where: { id: upload.scan.id },
        data: { status: "UPLOADED", completedAt: null },
      });
    }
    const runAttempt = retryingFailedInspection
      ? upload.scan.attemptCount + 1
      : undefined;
    await transaction.outboxEvent.upsert({
      where: {
        scanJobId_eventType: {
          scanJobId: upload.scan.id,
          eventType: "upload.inspect.requested",
        },
      },
      create: {
        organizationId,
        scanJobId: upload.scan.id,
        eventType: "upload.inspect.requested",
        payload: {
          scanJobId: upload.scan.id,
          uploadId: upload.id,
          kind: "UPLOAD_INSPECT",
          ...(runAttempt ? { runAttempt } : {}),
        },
      },
      update: {
        payload: {
          scanJobId: upload.scan.id,
          uploadId: upload.id,
          kind: "UPLOAD_INSPECT",
          ...(runAttempt ? { runAttempt } : {}),
        },
        status: "PENDING",
        claimToken: null,
        claimedAt: null,
        lastError: null,
      },
    });
    return {
      ...upload.scan,
      ...(retryingFailedInspection
        ? { status: "UPLOADED" as const, completedAt: null }
        : {}),
    };
  });
}

export async function persistUploadInspection(
  scanJobId: string,
  detectedFormat: "CSV" | "XLS" | "XLSX",
  inspection: Prisma.InputJsonValue,
  sheets: Array<{
    sheetIndex: number;
    name: string;
    rowCount: number;
    columnCount: number;
    headerCandidates: Prisma.InputJsonValue;
    columns: Prisma.InputJsonValue;
    preview: Prisma.InputJsonValue;
  }>,
) {
  await db.$transaction(async (transaction) => {
    const scan = await transaction.scanJob.findUnique({
      where: { id: scanJobId },
      include: { upload: true },
    });
    if (!scan?.upload) return;
    const upload = scan.upload;
    await transaction.uploadSheet.deleteMany({
      where: { uploadId: upload.id },
    });
    await transaction.uploadSheet.createMany({
      data: sheets.map((sheet) => ({ uploadId: upload.id, ...sheet })),
    });
    await transaction.upload.update({
      where: { id: upload.id },
      data: {
        detectedFormat,
        status: "MAPPING_REQUIRED",
        malwareStatus: "CLEAN",
        inspectedAt: new Date(),
      },
    });
    await transaction.scanJob.update({
      where: { id: scanJobId },
      data: { status: "MAPPING_REQUIRED" },
    });
    await transaction.scanCheckpoint.upsert({
      where: { scanJobId_stage: { scanJobId, stage: "UPLOAD_INSPECT" } },
      create: {
        scanJobId,
        stage: "UPLOAD_INSPECT",
        checksum: JSON.stringify(inspection).length.toString(),
        payload: inspection,
      },
      update: { payload: inspection },
    });
    await transaction.scanEvent.create({
      data: { scanJobId, eventType: "MAPPING_REQUIRED" },
    });
  });
}

export async function rejectUpload(scanJobId: string, rejectionCode: string) {
  await db.$transaction(async (transaction) => {
    const scan = await transaction.scanJob.findUnique({
      where: { id: scanJobId },
      include: { upload: true },
    });
    if (!scan?.upload) return;
    await transaction.upload.update({
      where: { id: scan.upload.id },
      data: { status: "REJECTED", malwareStatus: "ERROR", rejectionCode },
    });
    await transaction.scanJob.update({
      where: { id: scanJobId },
      data: { status: "FAILED_FINAL" },
    });
    await transaction.scanEvent.create({
      data: {
        scanJobId,
        eventType: "UPLOAD_REJECTED",
        payload: { rejectionCode },
      },
    });
  });
}

export async function saveColumnMappings(
  organizationId: string,
  scanJobId: string,
  uploadSheetId: string,
  headerRow: number,
  mappings: Array<{
    sourceIndex: number;
    sourceColumn: string;
    target: Prisma.ColumnMappingCreateManyInput["target"];
    required: boolean;
  }>,
) {
  return db.$transaction(async (transaction) => {
    await transaction.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${scanJobId})::bigint)
    `;
    const scan = await transaction.scanJob.findFirst({
      where: { id: scanJobId, organizationId },
      include: { upload: true, checkpoints: true },
    });
    if (!scan?.upload) return null;
    const sheet = await transaction.uploadSheet.findFirst({
      where: { id: uploadSheetId, uploadId: scan.upload.id },
    });
    if (!sheet) return null;
    if (!["MAPPING_REQUIRED", "READY"].includes(scan.status))
      throw new Error("MAPPING_NOT_READY");
    const preview = Array.isArray(sheet.preview)
      ? (sheet.preview as unknown[][])
      : [];
    const selectedHeader = preview[headerRow - 1];
    if (
      headerRow < 1 ||
      headerRow > sheet.rowCount ||
      !Array.isArray(selectedHeader) ||
      mappings.some((mapping) => {
        if (mapping.sourceIndex < 0 || mapping.sourceIndex >= sheet.columnCount)
          return true;
        const expected = String(
          selectedHeader[mapping.sourceIndex] ??
            `Column ${mapping.sourceIndex + 1}`,
        );
        return mapping.sourceColumn !== expected;
      })
    )
      throw new Error("MAPPING_STALE_SELECTION");
    const canonicalMappings = [...mappings].sort(
      (left, right) => left.sourceIndex - right.sourceIndex,
    );
    const checkpointPayload = {
      uploadSheetId,
      headerRow,
      mappings: canonicalMappings.map((mapping) => ({
        sourceIndex: mapping.sourceIndex,
        sourceColumn: mapping.sourceColumn,
        target: mapping.target,
        required: mapping.required,
      })),
    } satisfies Prisma.InputJsonObject;
    const checksum = requestFingerprint(checkpointPayload);
    const currentCheckpoint = scan.checkpoints.find(
      (checkpoint) => checkpoint.stage === "MAPPING",
    );
    if (currentCheckpoint?.checksum === checksum)
      return transaction.scanJob.findUnique({ where: { id: scanJobId } });
    await transaction.columnMapping.deleteMany({ where: { scanJobId } });
    await transaction.columnMapping.createMany({
      data: canonicalMappings.map((mapping) => ({ scanJobId, ...mapping })),
    });
    await transaction.uploadSheet.updateMany({
      where: { uploadId: scan.upload.id },
      data: { selectedHeaderRow: null },
    });
    await transaction.uploadSheet.update({
      where: { id: uploadSheetId },
      data: { selectedHeaderRow: headerRow },
    });
    await transaction.upload.update({
      where: { id: scan.upload.id },
      data: { status: "READY" },
    });
    const updated = await transaction.scanJob.update({
      where: { id: scanJobId },
      data: { status: "READY" },
    });
    await transaction.scanCheckpoint.upsert({
      where: { scanJobId_stage: { scanJobId, stage: "MAPPING" } },
      create: {
        scanJobId,
        stage: "MAPPING",
        checksum,
        payload: checkpointPayload,
      },
      update: { checksum, payload: checkpointPayload },
    });
    await transaction.scanEvent.create({
      data: {
        scanJobId,
        eventType: "MAPPING_CONFIRMED",
        payload: { uploadSheetId, headerRow, checksum },
      },
    });
    return updated;
  });
}

export async function saveSheetProfile(
  organizationId: string,
  supplierId: string,
  name: string,
  headerRow: number,
  mapping: Prisma.InputJsonValue,
) {
  return db.$transaction(async (transaction) => {
    const supplier = await transaction.supplier.findFirst({
      where: { id: supplierId, organizationId },
    });
    if (!supplier) return null;
    return transaction.sheetProfile.upsert({
      where: { supplierId_name: { supplierId, name } },
      create: { organizationId, supplierId, name, headerRow, mapping },
      update: { headerRow, mapping, version: { increment: 1 } },
    });
  });
}

export async function listSheetProfiles(
  organizationId: string,
  supplierId: string,
) {
  const supplier = await db.supplier.findFirst({
    where: { id: supplierId, organizationId },
    select: { id: true },
  });
  if (!supplier) return null;
  return db.sheetProfile.findMany({
    where: { organizationId, supplierId },
    orderBy: [{ name: "asc" }, { version: "desc" }],
  });
}

export async function queueNormalization(
  organizationId: string,
  scanJobId: string,
) {
  return db.$transaction(async (transaction) => {
    const scan = await transaction.scanJob.findFirst({
      where: { id: scanJobId, organizationId },
      include: { upload: true, columnMappings: true },
    });
    if (!scan?.upload || scan.status !== "READY") return null;
    if (scan.columnMappings.length === 0) return null;
    await transaction.scanJob.update({
      where: { id: scanJobId },
      data: { status: "NORMALIZING" },
    });
    await transaction.upload.update({
      where: { id: scan.upload.id },
      data: { status: "NORMALIZING" },
    });
    await transaction.outboxEvent.upsert({
      where: {
        scanJobId_eventType: {
          scanJobId,
          eventType: "scan.normalize.requested",
        },
      },
      create: {
        organizationId,
        scanJobId,
        eventType: "scan.normalize.requested",
        payload: { scanJobId, uploadId: scan.upload.id, kind: "NORMALIZE" },
      },
      update: {
        status: "PENDING",
        claimToken: null,
        claimedAt: null,
        lastError: null,
      },
    });
    return scan;
  });
}

export async function failUploadStage(
  scanJobId: string,
  stage: "UPLOAD_INSPECT" | "NORMALIZE",
  status: Extract<ScanJobStatus, "FAILED_RETRYABLE" | "FAILED_FINAL">,
  errorCode: string,
  terminal: boolean,
  malwareStatus?: "INFECTED" | "ERROR",
) {
  await db.$transaction(async (transaction) => {
    const scan = await transaction.scanJob.findUnique({
      where: { id: scanJobId },
      include: { upload: true },
    });
    if (!scan?.upload) return;
    await transaction.scanJob.update({
      where: { id: scanJobId },
      data: { status, attemptCount: { increment: 1 } },
    });
    await transaction.upload.update({
      where: { id: scan.upload.id },
      data: terminal
        ? {
            status: "REJECTED",
            rejectionCode: errorCode,
            ...(malwareStatus ? { malwareStatus } : {}),
          }
        : {
            status: stage === "UPLOAD_INSPECT" ? "INSPECTING" : "NORMALIZING",
            rejectionCode: errorCode,
            ...(malwareStatus ? { malwareStatus } : {}),
          },
    });
    await transaction.scanEvent.create({
      data: {
        scanJobId,
        eventType: status,
        payload: { stage, errorCode, terminal },
      },
    });
  });
}

export async function persistNormalizedRows(
  scanJobId: string,
  uploadSheetId: string,
  rows: Array<{
    sourceRowNumber: number;
    rawData: Prisma.InputJsonValue;
    rowChecksum: string;
    offer: Record<string, string | number | null | undefined>;
    warnings: Array<{
      code: string;
      severity: "INFO" | "WARNING" | "ERROR";
      field: string;
    }>;
  }>,
) {
  await db.$transaction(async (transaction) => {
    const scan = await transaction.scanJob.findUnique({
      where: { id: scanJobId },
      include: { upload: true },
    });
    if (!scan?.upload) return;
    await transaction.supplierRow.deleteMany({ where: { scanJobId } });
    const createdRows = rows.map((row) => ({
      id: randomUUID(),
      scanJobId,
      uploadSheetId,
      sourceRowNumber: row.sourceRowNumber,
      rawData: row.rawData,
      rowChecksum: row.rowChecksum,
      normalizationStatus:
        row.warnings.length === 0
          ? ("NORMALIZED" as const)
          : ("WARNING" as const),
    }));
    await transaction.supplierRow.createMany({ data: createdRows });
    await transaction.normalizedOffer.createMany({
      data: rows.map((row, index) => ({
        supplierRowId: createdRows[index]!.id,
        asin: stringOrNull(row.offer.asin),
        upc: stringOrNull(row.offer.upc),
        ean: stringOrNull(row.offer.ean),
        gtin: stringOrNull(row.offer.gtin),
        mpn: stringOrNull(row.offer.mpn),
        itemNumber: stringOrNull(row.offer.item_number),
        description: stringOrNull(row.offer.description),
        brand: stringOrNull(row.offer.brand),
        unitCost: decimalOrNull(row.offer.unit_cost),
        currency: stringOrNull(row.offer.currency),
        quantity: integerOrNull(row.offer.quantity),
        caseCount: integerOrNull(row.offer.case_count),
        packCount: integerOrNull(row.offer.pack_count),
        weight: decimalOrNull(row.offer.weight),
        length: decimalOrNull(row.offer.length),
        width: decimalOrNull(row.offer.width),
        height: decimalOrNull(row.offer.height),
      })),
    });
    const warningRows = rows.flatMap((row, index) =>
      row.warnings.map((warning) => ({
        id: randomUUID(),
        supplierRowId: createdRows[index]!.id,
        code: warning.code,
        severity: warning.severity,
        field: warning.field,
      })),
    );
    if (warningRows.length > 0)
      await transaction.normalizationWarning.createMany({ data: warningRows });
    await transaction.upload.update({
      where: { id: scan.upload.id },
      data: { status: "COMPLETED" },
    });
    await transaction.scanJob.update({
      where: { id: scanJobId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    await transaction.scanCheckpoint.upsert({
      where: { scanJobId_stage: { scanJobId, stage: "NORMALIZE" } },
      create: {
        scanJobId,
        stage: "NORMALIZE",
        checksum: rows.length.toString(),
        payload: { rowCount: rows.length },
      },
      update: { payload: { rowCount: rows.length } },
    });
    await transaction.scanEvent.create({
      data: {
        scanJobId,
        eventType: "COMPLETED",
        payload: { rowCount: rows.length },
      },
    });
  });
}

export async function queueMatching(organizationId: string, scanJobId: string) {
  return db.$transaction(async (transaction) => {
    const scan = await transaction.scanJob.findFirst({
      where: { id: scanJobId, organizationId, jobType: "UPLOAD" },
      include: { _count: { select: { supplierRows: true } } },
    });
    if (!scan || scan._count.supplierRows === 0) return null;
    if (scan.status === "MATCHING") return scan;
    if (scan.status !== "COMPLETED") return null;
    const updated = await transaction.scanJob.update({
      where: { id: scan.id },
      data: { status: "MATCHING", completedAt: null },
    });
    await transaction.outboxEvent.upsert({
      where: {
        scanJobId_eventType: {
          scanJobId: scan.id,
          eventType: "scan.match.requested",
        },
      },
      create: {
        organizationId,
        scanJobId: scan.id,
        eventType: "scan.match.requested",
        payload: { scanJobId: scan.id, kind: "MATCH" },
      },
      update: {
        status: "PENDING",
        claimToken: null,
        claimedAt: null,
        lastError: null,
      },
    });
    return updated;
  });
}

export type ScanWorkflowStage =
  | "MAPPING_REQUIRED"
  | "NORMALIZE"
  | "MATCH"
  | "ENRICH"
  | "CALCULATE"
  | "COMPLETE"
  | "FAILED";

export async function queueNextScanStage(
  organizationId: string,
  scanJobId: string,
): Promise<{ stage: ScanWorkflowStage; status: ScanJobStatus } | null> {
  let scan = await db.scanJob.findFirst({
    where: { id: scanJobId, organizationId, jobType: "UPLOAD" },
    include: {
      upload: { select: { status: true } },
      checkpoints: { select: { stage: true } },
    },
  });
  if (!scan) return null;
  if (scan.upload?.status === "REJECTED")
    return { stage: "FAILED", status: scan.status };
  const activeStage: Partial<Record<ScanJobStatus, ScanWorkflowStage>> = {
    NORMALIZING: "NORMALIZE",
    MATCHING: "MATCH",
    ENRICHING: "ENRICH",
    CALCULATING: "CALCULATE",
  };
  const active = activeStage[scan.status];
  if (active) return { stage: active, status: scan.status };
  const checkpoints = new Set(scan.checkpoints.map(({ stage }) => stage));
  if (!checkpoints.has("MAPPING"))
    return { stage: "MAPPING_REQUIRED", status: scan.status };
  if (["FAILED_RETRYABLE", "FAILED_FINAL"].includes(scan.status)) {
    const resumeStatus: ScanJobStatus = checkpoints.has("NORMALIZE")
      ? "COMPLETED"
      : "READY";
    scan = await db.scanJob.update({
      where: { id: scan.id },
      data: { status: resumeStatus, completedAt: null },
      include: {
        upload: { select: { status: true } },
        checkpoints: { select: { stage: true } },
      },
    });
    if (!checkpoints.has("NORMALIZE") && scan.upload && scan.uploadId)
      await db.upload.update({
        where: { id: scan.uploadId },
        data: { status: "READY", rejectionCode: null },
      });
  }
  if (!checkpoints.has("NORMALIZE")) {
    const queued = await queueNormalization(organizationId, scanJobId);
    return queued ? { stage: "NORMALIZE", status: "NORMALIZING" } : null;
  }
  if (!checkpoints.has("MATCH")) {
    const queued = await queueMatching(organizationId, scanJobId);
    return queued ? { stage: "MATCH", status: "MATCHING" } : null;
  }
  if (!checkpoints.has("ENRICH")) {
    const queued = await queueEnrichment(organizationId, scanJobId);
    if (queued) return { stage: "ENRICH", status: "ENRICHING" };
  }
  if (!checkpoints.has("CALCULATE")) {
    const queued = await queueProfitCalculation(organizationId, scanJobId);
    return queued ? { stage: "CALCULATE", status: "CALCULATING" } : null;
  }
  return { stage: "COMPLETE", status: scan.status };
}

export async function getScanRowsForMatching(scanJobId: string) {
  return db.scanJob.findUnique({
    where: { id: scanJobId },
    include: {
      supplierRows: {
        orderBy: { sourceRowNumber: "asc" },
        include: { normalizedOffer: true },
      },
    },
  });
}

export async function getCompletedMatchLookup(
  scanJobId: string,
  provider: string,
  lookupType:
    "SUPPLIED_ASIN" | "EXACT_IDENTIFIER" | "MPN_BRAND" | "TITLE_SEARCH",
  lookupKey: string,
) {
  return db.matchLookup.findUnique({
    where: {
      scanJobId_provider_lookupType_lookupKey: {
        scanJobId,
        provider,
        lookupType,
        lookupKey,
      },
    },
  });
}

export async function saveMatchLookup(input: {
  organizationId: string;
  scanJobId: string;
  provider: string;
  lookupType:
    "SUPPLIED_ASIN" | "EXACT_IDENTIFIER" | "MPN_BRAND" | "TITLE_SEARCH";
  lookupKey: string;
  payload: Prisma.InputJsonValue;
  observedAt: Date;
  freshnessState: "FRESH" | "STALE" | "EXPIRED" | "UNKNOWN";
}) {
  return db.matchLookup.upsert({
    where: {
      scanJobId_provider_lookupType_lookupKey: {
        scanJobId: input.scanJobId,
        provider: input.provider,
        lookupType: input.lookupType,
        lookupKey: input.lookupKey,
      },
    },
    create: { ...input, status: "COMPLETED" },
    update: {
      payload: input.payload,
      observedAt: input.observedAt,
      freshnessState: input.freshnessState,
      status: "COMPLETED",
      errorCode: null,
    },
  });
}

type PersistedMatchEvidence = {
  feature:
    "IDENTIFIER" | "BRAND" | "MODEL" | "SIZE" | "PACK" | "VARIATION" | "TITLE";
  outcome: "AGREEMENT" | "CONTRADICTION" | "UNKNOWN" | "NOT_APPLICABLE";
  score: number;
  reasonCode: string;
  details: Prisma.InputJsonValue;
};

export type PersistedMatchCandidate = {
  source: "SUPPLIED_ASIN" | "EXACT_IDENTIFIER" | "MPN_BRAND" | "TITLE_SEARCH";
  confidence: number;
  product: {
    asin: string;
    title: string;
    brand?: string | undefined;
    model?: string | undefined;
    mpn?: string | undefined;
    sizeText?: string | undefined;
    packCount?: number | undefined;
    variation?: string | undefined;
    manufacturer?: string | undefined;
    color?: string | undefined;
    productTypes?: string[] | undefined;
    variationTheme?: string | undefined;
    packageHierarchy?: unknown;
    images?: unknown;
    dimensions?: unknown;
    salesRanks?: unknown;
    rawProviderObservation?: unknown;
    identifiers: Array<{
      type: "ASIN" | "UPC" | "EAN" | "GTIN" | "MPN";
      value: string;
    }>;
    provenance: {
      provider: string;
      providerReference?: string | undefined;
      marketplaceId?: string | undefined;
      requestId?: string | undefined;
      responseCompleteness?: "COMPLETE" | "PARTIAL" | undefined;
      observedAt: string;
      freshnessState: "FRESH" | "STALE" | "EXPIRED" | "UNKNOWN";
    };
  };
  evidence: PersistedMatchEvidence[];
  packGuard: {
    status:
      "VERIFIED" | "BLOCKED_PACK_UNCERTAIN" | "BLOCKED_PACK_CONTRADICTION";
    supplierUnitsPerCase: number | null;
    amazonUnitsPerPack: number | null;
    sellableUnitsPerCase: number | null;
    remainderUnits: number | null;
    costPerSellableUnit: string | null;
    reasonCode: string;
  };
};

export async function persistMatchRow(input: {
  organizationId: string;
  supplierRowId: string;
  candidates: PersistedMatchCandidate[];
  decision: {
    status: "AUTO_ACCEPTED" | "REVIEW_REQUIRED" | "UNMATCHED";
    confidence: number;
    selectedAsin: string | null;
    reasonCodes: string[];
  };
}) {
  await db.$transaction(async (transaction) => {
    const row = await transaction.supplierRow.findFirst({
      where: {
        id: input.supplierRowId,
        scanJob: { organizationId: input.organizationId },
      },
    });
    if (!row) throw new Error("supplier_row_not_found");
    const existing = await transaction.matchDecision.findUnique({
      where: { supplierRowId: input.supplierRowId },
    });
    if (existing?.source === "HUMAN") return;
    if (existing)
      await transaction.matchDecision.delete({ where: { id: existing.id } });
    await transaction.listingCandidate.deleteMany({
      where: { supplierRowId: input.supplierRowId },
    });
    const candidateIds = new Map<string, string>();
    for (const candidate of input.candidates) {
      const product = await transaction.catalogProduct.upsert({
        where: {
          provider_providerReference: {
            provider: candidate.product.provenance.provider,
            providerReference:
              candidate.product.provenance.providerReference ??
              candidate.product.asin,
          },
        },
        create: {
          provider: candidate.product.provenance.provider,
          providerReference:
            candidate.product.provenance.providerReference ??
            candidate.product.asin,
          asin: candidate.product.asin,
          title: candidate.product.title,
          brand: candidate.product.brand ?? null,
          model: candidate.product.model ?? null,
          mpn: candidate.product.mpn ?? null,
          sizeText: candidate.product.sizeText ?? null,
          packCount: candidate.product.packCount ?? null,
          variation: candidate.product.variation ?? null,
          marketplaceId: candidate.product.provenance.marketplaceId ?? null,
          responseCompleteness:
            candidate.product.provenance.responseCompleteness ?? null,
          requestLineage: candidate.product.provenance.requestId ?? null,
          identityProjection: {
            manufacturer: candidate.product.manufacturer ?? null,
            color: candidate.product.color ?? null,
            productTypes: candidate.product.productTypes ?? [],
            variationTheme: candidate.product.variationTheme ?? null,
            packageHierarchy: candidate.product.packageHierarchy ?? [],
            images: candidate.product.images ?? [],
            dimensions: candidate.product.dimensions ?? null,
            salesRanks: candidate.product.salesRanks ?? [],
          } as unknown as Prisma.InputJsonValue,
          observedAt: new Date(candidate.product.provenance.observedAt),
          freshnessState: candidate.product.provenance.freshnessState,
          rawPayload: {
            normalized: candidate.product,
            rawProviderObservation:
              candidate.product.rawProviderObservation ?? null,
          } as unknown as Prisma.InputJsonValue,
        },
        update: {
          asin: candidate.product.asin,
          title: candidate.product.title,
          brand: candidate.product.brand ?? null,
          model: candidate.product.model ?? null,
          mpn: candidate.product.mpn ?? null,
          sizeText: candidate.product.sizeText ?? null,
          packCount: candidate.product.packCount ?? null,
          variation: candidate.product.variation ?? null,
          marketplaceId: candidate.product.provenance.marketplaceId ?? null,
          responseCompleteness:
            candidate.product.provenance.responseCompleteness ?? null,
          requestLineage: candidate.product.provenance.requestId ?? null,
          identityProjection: {
            manufacturer: candidate.product.manufacturer ?? null,
            color: candidate.product.color ?? null,
            productTypes: candidate.product.productTypes ?? [],
            variationTheme: candidate.product.variationTheme ?? null,
            packageHierarchy: candidate.product.packageHierarchy ?? [],
            images: candidate.product.images ?? [],
            dimensions: candidate.product.dimensions ?? null,
            salesRanks: candidate.product.salesRanks ?? [],
          } as unknown as Prisma.InputJsonValue,
          observedAt: new Date(candidate.product.provenance.observedAt),
          freshnessState: candidate.product.provenance.freshnessState,
          rawPayload: {
            normalized: candidate.product,
            rawProviderObservation:
              candidate.product.rawProviderObservation ?? null,
          } as unknown as Prisma.InputJsonValue,
        },
      });
      await transaction.productIdentifier.deleteMany({
        where: { catalogProductId: product.id },
      });
      if (candidate.product.identifiers.length > 0) {
        await transaction.productIdentifier.createMany({
          data: candidate.product.identifiers.map((identifier) => ({
            catalogProductId: product.id,
            type: identifier.type,
            value: identifier.value,
          })),
        });
      }
      const stored = await transaction.listingCandidate.create({
        data: {
          organizationId: input.organizationId,
          supplierRowId: input.supplierRowId,
          catalogProductId: product.id,
          source: candidate.source,
          confidence: candidate.confidence,
        },
      });
      candidateIds.set(candidate.product.asin, stored.id);
      await transaction.matchEvidence.createMany({
        data: candidate.evidence.map((evidence) => ({
          listingCandidateId: stored.id,
          feature: evidence.feature,
          outcome: evidence.outcome,
          score: evidence.score,
          reasonCode: evidence.reasonCode,
          details: evidence.details,
        })),
      });
      await transaction.packGuardResult.create({
        data: { listingCandidateId: stored.id, ...candidate.packGuard },
      });
    }
    await transaction.matchDecision.create({
      data: {
        organizationId: input.organizationId,
        supplierRowId: input.supplierRowId,
        selectedCandidateId: input.decision.selectedAsin
          ? (candidateIds.get(input.decision.selectedAsin) ?? null)
          : null,
        status: input.decision.status,
        confidence: input.decision.confidence,
        reasonCodes: input.decision.reasonCodes,
        source: "SYSTEM",
      },
    });
  });
}

export async function completeMatching(scanJobId: string, rowCount: number) {
  await db.$transaction(async (transaction) => {
    await transaction.scanJob.update({
      where: { id: scanJobId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    await transaction.scanCheckpoint.upsert({
      where: { scanJobId_stage: { scanJobId, stage: "MATCH" } },
      create: {
        scanJobId,
        stage: "MATCH",
        checksum: String(rowCount),
        payload: { rowCount },
      },
      update: { checksum: String(rowCount), payload: { rowCount } },
    });
    await transaction.scanEvent.create({
      data: { scanJobId, eventType: "MATCH_COMPLETED", payload: { rowCount } },
    });
  });
}

export async function listMatchDecisions(
  organizationId: string,
  scanJobId: string,
) {
  return db.matchDecision.findMany({
    where: { organizationId, supplierRow: { scanJobId } },
    orderBy: { supplierRow: { sourceRowNumber: "asc" } },
    include: {
      supplierRow: {
        include: {
          normalizedOffer: true,
          listingCandidates: {
            include: {
              catalogProduct: true,
              evidence: true,
              packGuard: true,
            },
            orderBy: { confidence: "desc" },
          },
        },
      },
      selectedCandidate: {
        include: {
          catalogProduct: true,
          evidence: true,
          packGuard: true,
        },
      },
    },
  });
}

export async function reviewMatchDecision(input: {
  organizationId: string;
  supplierRowId: string;
  selectedCandidateId: string | null;
  status: "USER_ACCEPTED" | "USER_REJECTED";
  reason: string;
  idempotencyKey: string;
}) {
  return db.$transaction(async (transaction) => {
    const fingerprint = requestFingerprint({
      supplierRowId: input.supplierRowId,
      selectedCandidateId: input.selectedCandidateId,
      status: input.status,
      reason: input.reason,
    });
    const previous = await transaction.workflowAuditEvent.findUnique({
      where: {
        organizationId_idempotencyKey: {
          organizationId: input.organizationId,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (previous) {
      assertIdempotentEvent(previous, {
        entityType: "MatchDecision",
        entityId: input.supplierRowId,
        eventType: "match.reviewed",
        fingerprint,
      });
      return transaction.matchDecision.findFirst({
        where: {
          supplierRowId: input.supplierRowId,
          organizationId: input.organizationId,
        },
      });
    }
    const decision = await transaction.matchDecision.findFirst({
      where: {
        supplierRowId: input.supplierRowId,
        organizationId: input.organizationId,
      },
    });
    if (!decision) return null;
    if (input.status === "USER_ACCEPTED" && !input.selectedCandidateId)
      return null;
    let hardContradiction = false;
    if (input.selectedCandidateId) {
      const candidate = await transaction.listingCandidate.findFirst({
        where: {
          id: input.selectedCandidateId,
          supplierRowId: input.supplierRowId,
          organizationId: input.organizationId,
        },
        include: { evidence: true },
      });
      if (!candidate) return null;
      hardContradiction = candidate.evidence.some(
        (evidence) =>
          evidence.outcome === "CONTRADICTION" &&
          ["BRAND", "MODEL", "SIZE", "PACK", "VARIATION"].includes(
            evidence.feature,
          ),
      );
    }
    const reasonCodes = Array.isArray(decision.reasonCodes)
      ? decision.reasonCodes.filter(
          (code): code is string => typeof code === "string",
        )
      : [];
    const updated = await transaction.matchDecision.update({
      where: { id: decision.id },
      data: {
        selectedCandidateId: input.selectedCandidateId,
        status: input.status,
        source: "HUMAN",
        reasonCodes: [
          ...new Set([
            ...reasonCodes,
            "HUMAN_REVIEWED",
            ...(hardContradiction
              ? ["HARD_CONTRADICTION_MANUAL_OVERRIDE"]
              : []),
          ]),
        ],
        reviewedAt: new Date(),
      },
    });
    await transaction.workflowAuditEvent.create({
      data: {
        organizationId: input.organizationId,
        entityType: "MatchDecision",
        entityId: input.supplierRowId,
        eventType: "match.reviewed",
        idempotencyKey: input.idempotencyKey,
        reason: input.reason,
        payload: {
          fingerprint,
          status: input.status,
          selectedCandidateId: input.selectedCandidateId,
          hardContradiction,
        },
      },
    });
    return updated;
  });
}

export function isProfitVerifiedMatch(input: {
  status: string | null | undefined;
  reasonCodes: unknown;
}): boolean {
  if (!["AUTO_ACCEPTED", "USER_ACCEPTED"].includes(input.status ?? ""))
    return false;
  const reasons = Array.isArray(input.reasonCodes) ? input.reasonCodes : [];
  return !reasons.includes("HARD_CONTRADICTION_MANUAL_OVERRIDE");
}

const DEFAULT_MARKETPLACE_ID = "ATVPDKIKX0DER";

/** Creates the fixture-only connection used by local development and tests. */
export async function ensureMockAmazonConnection(organizationId: string) {
  return db.providerConnection.upsert({
    where: {
      organizationId_provider_marketplaceId: {
        organizationId,
        provider: "MOCK_AMAZON",
        marketplaceId: DEFAULT_MARKETPLACE_ID,
      },
    },
    create: {
      organizationId,
      provider: "MOCK_AMAZON",
      mode: "MOCK",
      status: "ACTIVE",
      marketplaceId: DEFAULT_MARKETPLACE_ID,
      region: "NA",
    },
    update: {},
  });
}

/** Credential-free projection for status UI. Tenant scope is mandatory. */
export async function getAmazonProviderConnectionStatus(
  organizationId: string,
) {
  return db.providerConnection.findFirst({
    where: { organizationId, provider: "AMAZON_SP_API" },
    orderBy: { updatedAt: "desc" },
    select: {
      status: true,
      lastValidatedAt: true,
      lastSuccessAt: true,
      lastErrorCode: true,
    },
  });
}

/** Worker-only connection lookup. The caller receives encrypted material but
 * must decrypt it locally; web routes only use the status projection above. */
export async function getCatalogProviderConnection(organizationId: string) {
  if (
    process.env.PROVIDER_MODE === "sp_api" ||
    process.env.PROVIDER_MODE === "sp-api"
  ) {
    return db.providerConnection.findFirst({
      where: { organizationId, provider: "AMAZON_SP_API", status: "ACTIVE" },
      orderBy: { authorizedAt: "desc" },
    });
  }
  return ensureMockAmazonConnection(organizationId);
}

export async function queueEnrichment(
  organizationId: string,
  scanJobId: string,
) {
  return db.$transaction(async (transaction) => {
    const scan = await transaction.scanJob.findFirst({
      where: { id: scanJobId, organizationId, jobType: "UPLOAD" },
      include: { _count: { select: { supplierRows: true } } },
    });
    if (!scan || scan._count.supplierRows === 0) return null;
    if (!["COMPLETED", "PARTIAL_SUCCESS"].includes(scan.status)) return null;
    const connection =
      process.env.PROVIDER_MODE === "sp_api" ||
      process.env.PROVIDER_MODE === "sp-api"
        ? await transaction.providerConnection.findFirst({
            where: {
              organizationId,
              provider: "AMAZON_SP_API",
              status: "ACTIVE",
            },
            orderBy: { authorizedAt: "desc" },
          })
        : await transaction.providerConnection.upsert({
            where: {
              organizationId_provider_marketplaceId: {
                organizationId,
                provider: "MOCK_AMAZON",
                marketplaceId: DEFAULT_MARKETPLACE_ID,
              },
            },
            create: {
              organizationId,
              provider: "MOCK_AMAZON",
              mode: "MOCK",
              status: "ACTIVE",
              marketplaceId: DEFAULT_MARKETPLACE_ID,
              region: "NA",
            },
            update: {},
          });
    if (!connection) return null;
    const selected = await transaction.matchDecision.findMany({
      where: {
        organizationId,
        supplierRow: { scanJobId },
        status: { in: ["AUTO_ACCEPTED", "USER_ACCEPTED"] },
        selectedCandidateId: { not: null },
      },
      select: {
        supplierRowId: true,
        selectedCandidate: {
          select: { catalogProduct: { select: { asin: true } } },
        },
      },
    });
    if (selected.length === 0) return null;
    const run = await transaction.enrichmentRun.upsert({
      where: {
        scanJobId_providerConnectionId: {
          scanJobId,
          providerConnectionId: connection.id,
        },
      },
      create: {
        organizationId,
        scanJobId,
        providerConnectionId: connection.id,
        status: "PENDING",
        attemptCount: 1,
      },
      update: {
        status: "PENDING",
        completedAt: null,
        attemptCount: { increment: 1 },
      },
    });
    await transaction.enrichmentItem.createMany({
      data: selected.flatMap((decision) =>
        decision.selectedCandidate?.catalogProduct.asin
          ? [
              {
                enrichmentRunId: run.id,
                supplierRowId: decision.supplierRowId,
                asin: decision.selectedCandidate.catalogProduct.asin,
              },
            ]
          : [],
      ),
      skipDuplicates: true,
    });
    await transaction.enrichmentItem.updateMany({
      where: { enrichmentRunId: run.id, status: "PARTIAL_SUCCESS" },
      data: { status: "PENDING" },
    });
    await transaction.scanJob.update({
      where: { id: scanJobId },
      data: { status: "ENRICHING", completedAt: null },
    });
    await transaction.outboxEvent.upsert({
      where: {
        scanJobId_eventType: { scanJobId, eventType: "scan.enrich.requested" },
      },
      create: {
        organizationId,
        scanJobId,
        eventType: "scan.enrich.requested",
        payload: { scanJobId, kind: "ENRICH", runAttempt: run.attemptCount },
      },
      update: {
        status: "PENDING",
        claimToken: null,
        claimedAt: null,
        lastError: null,
        payload: { scanJobId, kind: "ENRICH", runAttempt: run.attemptCount },
      },
    });
    return run;
  });
}

export async function getEnrichmentRunForProcessing(scanJobId: string) {
  return db.enrichmentRun.findFirst({
    where: { scanJobId },
    include: {
      providerConnection: true,
      items: { include: { observations: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function recordProviderCallAttempt(input: {
  organizationId: string;
  enrichmentRunId: string;
  provider: "MOCK_AMAZON" | "AMAZON_SP_API" | "MOCK_HISTORY";
  operation: string;
  requestKey: string;
  attempt: number;
  status: "SUCCESS" | "RETRYABLE_ERROR" | "PERMANENT_ERROR" | "THROTTLED";
  errorCode?: string;
  httpStatus?: number;
  providerRequestId?: string;
  retryAt?: Date;
}) {
  return db.providerCallAttempt.upsert({
    where: {
      organizationId_enrichmentRunId_provider_operation_requestKey_attempt: {
        organizationId: input.organizationId,
        enrichmentRunId: input.enrichmentRunId,
        provider: input.provider,
        operation: input.operation,
        requestKey: input.requestKey,
        attempt: input.attempt,
      },
    },
    create: input,
    update: input,
  });
}

export async function persistEnrichmentItem(input: {
  enrichmentItemId: string;
  observations: Array<{
    metricType: "CATALOG" | "PRICING" | "FEES" | "RESTRICTIONS" | "HISTORY";
    provider: "MOCK_AMAZON" | "AMAZON_SP_API" | "MOCK_HISTORY";
    observedAt: Date;
    freshUntil: Date;
    freshnessState: "FRESH" | "STALE" | "EXPIRED" | "UNKNOWN";
    marketplaceId: string;
    providerReference?: string;
    payload: Prisma.InputJsonValue;
    primaryAmount?: string;
    secondaryAmount?: string;
    quotedPrice?: string;
    currency?: string;
  }>;
  missingMetrics: string[];
  errorCode?: string;
}) {
  await db.$transaction(async (transaction) => {
    for (const observation of input.observations) {
      const current = await transaction.providerObservation.findUnique({
        where: {
          enrichmentItemId_metricType_provider: {
            enrichmentItemId: input.enrichmentItemId,
            metricType: observation.metricType,
            provider: observation.provider,
          },
        },
        select: { observedAt: true },
      });
      // A delayed retry must not regress current market evidence.
      if (
        current &&
        current.observedAt.getTime() > observation.observedAt.getTime()
      )
        continue;
      await transaction.providerObservation.upsert({
        where: {
          enrichmentItemId_metricType_provider: {
            enrichmentItemId: input.enrichmentItemId,
            metricType: observation.metricType,
            provider: observation.provider,
          },
        },
        create: {
          ...observation,
          enrichmentItemId: input.enrichmentItemId,
          freshnessState: observation.freshnessState,
        },
        update: { ...observation, errorCode: null },
      });
    }
    await transaction.enrichmentItem.update({
      where: { id: input.enrichmentItemId },
      data: {
        status: input.missingMetrics.length ? "PARTIAL_SUCCESS" : "COMPLETED",
        missingMetrics: input.missingMetrics,
        lastErrorCode: input.errorCode ?? null,
      },
    });
  });
}

export async function completeEnrichmentRun(enrichmentRunId: string) {
  await db.$transaction(async (transaction) => {
    const run = await transaction.enrichmentRun.findUnique({
      where: { id: enrichmentRunId },
      include: { items: true },
    });
    if (!run) return;
    const partial = run.items.some((item) => item.status !== "COMPLETED");
    const status = partial ? "PARTIAL_SUCCESS" : "COMPLETED";
    await transaction.enrichmentRun.update({
      where: { id: run.id },
      data: {
        status,
        completedAt: new Date(),
        missingMetricCount: run.items.filter(
          (item) => item.status !== "COMPLETED",
        ).length,
      },
    });
    await transaction.scanJob.update({
      where: { id: run.scanJobId },
      data: { status, completedAt: new Date() },
    });
    await transaction.scanCheckpoint.upsert({
      where: { scanJobId_stage: { scanJobId: run.scanJobId, stage: "ENRICH" } },
      create: {
        scanJobId: run.scanJobId,
        stage: "ENRICH",
        checksum: String(run.items.length),
        payload: { runId: run.id, status },
      },
      update: {
        checksum: String(run.items.length),
        payload: { runId: run.id, status },
      },
    });
    await transaction.scanEvent.create({
      data: {
        scanJobId: run.scanJobId,
        eventType: status,
        payload: { stage: "ENRICH", partial },
      },
    });
  });
}

/** Schedule a retry through the transactional outbox rather than sleeping a worker. */
export async function scheduleEnrichmentRetry(
  enrichmentRunId: string,
  retryAt: Date,
  maxAttempts = 3,
): Promise<boolean> {
  return db.$transaction(async (transaction) => {
    const run = await transaction.enrichmentRun.findUnique({
      where: { id: enrichmentRunId },
      select: {
        id: true,
        scanJobId: true,
        organizationId: true,
        attemptCount: true,
      },
    });
    if (!run || run.attemptCount >= maxAttempts) return false;
    const nextAttempt = run.attemptCount + 1;
    await transaction.enrichmentRun.update({
      where: { id: run.id },
      data: { status: "PENDING", completedAt: null, attemptCount: nextAttempt },
    });
    await transaction.enrichmentItem.updateMany({
      where: { enrichmentRunId: run.id, status: "PARTIAL_SUCCESS" },
      data: { status: "PENDING" },
    });
    await transaction.scanJob.update({
      where: { id: run.scanJobId },
      data: { status: "ENRICHING", completedAt: null },
    });
    await transaction.outboxEvent.update({
      where: {
        scanJobId_eventType: {
          scanJobId: run.scanJobId,
          eventType: "scan.enrich.requested",
        },
      },
      data: {
        status: "PENDING",
        claimToken: null,
        claimedAt: null,
        lastError: null,
        payload: {
          scanJobId: run.scanJobId,
          kind: "ENRICH",
          runAttempt: nextAttempt,
          notBefore: retryAt.toISOString(),
        },
      },
    });
    return true;
  });
}

export async function listEnrichmentForScan(
  organizationId: string,
  scanJobId: string,
) {
  return db.enrichmentRun.findMany({
    where: { organizationId, scanJobId },
    include: {
      providerConnection: {
        select: {
          provider: true,
          status: true,
          marketplaceId: true,
          updatedAt: true,
        },
      },
      items: { include: { observations: true }, orderBy: { createdAt: "asc" } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function saveFinancialPolicy(input: {
  organizationId: string;
  currency: string;
  minNetProfit: string;
  minRoiPercent: string;
  minMarginPercent: string;
  maxStressLoss: string;
  stressDiscountPercent: string;
  minimumDemandScore?: number;
  engineVersion: string;
}) {
  return db.financialPolicy.upsert({
    where: { organizationId: input.organizationId },
    create: {
      ...input,
      minimumDemandScore: input.minimumDemandScore ?? 1,
    },
    update: {
      currency: input.currency,
      minNetProfit: input.minNetProfit,
      minRoiPercent: input.minRoiPercent,
      minMarginPercent: input.minMarginPercent,
      maxStressLoss: input.maxStressLoss,
      stressDiscountPercent: input.stressDiscountPercent,
      minimumDemandScore: input.minimumDemandScore ?? 1,
      engineVersion: input.engineVersion,
    },
  });
}

export async function saveShippingRoute(input: {
  organizationId: string;
  name: string;
  currency: string;
  effectiveFrom: Date;
  effectiveTo?: Date;
  active?: boolean;
  allocatedSupplierFreight: string;
  prepFee: string;
  labelingFee: string;
  polybagFee: string;
  bundleFee: string;
  bubblewrapFee: string;
  inboundShipping: string;
  dutyOrTax: string;
  storageAllowance: string;
  returnAllowance: string;
  otherCosts: string;
}) {
  return db.shippingRoute.upsert({
    where: {
      organizationId_name_effectiveFrom: {
        organizationId: input.organizationId,
        name: input.name,
        effectiveFrom: input.effectiveFrom,
      },
    },
    create: {
      ...input,
      active: input.active ?? true,
    },
    update: {
      currency: input.currency,
      effectiveTo: input.effectiveTo ?? null,
      active: input.active ?? true,
      allocatedSupplierFreight: input.allocatedSupplierFreight,
      prepFee: input.prepFee,
      labelingFee: input.labelingFee,
      polybagFee: input.polybagFee,
      bundleFee: input.bundleFee,
      bubblewrapFee: input.bubblewrapFee,
      inboundShipping: input.inboundShipping,
      dutyOrTax: input.dutyOrTax,
      storageAllowance: input.storageAllowance,
      returnAllowance: input.returnAllowance,
      otherCosts: input.otherCosts,
    },
  });
}

export async function saveBrandPolicy(input: {
  organizationId: string;
  brand: string;
  status: "PROHIBITED" | "APPROVAL_REQUIRED" | "APPROVED" | "UNRESTRICTED";
  approvalReference?: string;
  expiresAt?: Date;
}) {
  return db.brandPolicy.upsert({
    where: {
      organizationId_brand: {
        organizationId: input.organizationId,
        brand: input.brand,
      },
    },
    create: input,
    update: {
      status: input.status,
      approvalReference: input.approvalReference ?? null,
      expiresAt: input.expiresAt ?? null,
    },
  });
}

export async function getBrandPolicy(organizationId: string, brand: string) {
  return db.brandPolicy.findUnique({
    where: { organizationId_brand: { organizationId, brand } },
  });
}

export async function queueProfitCalculation(
  organizationId: string,
  scanJobId: string,
) {
  return db.$transaction(async (transaction) => {
    const scan = await transaction.scanJob.findFirst({
      where: {
        id: scanJobId,
        organizationId,
        jobType: "UPLOAD",
        status: { in: ["COMPLETED", "PARTIAL_SUCCESS"] },
      },
    });
    const policy = await transaction.financialPolicy.findUnique({
      where: { organizationId },
    });
    if (!scan || !policy) return null;
    const route = await transaction.shippingRoute.findFirst({
      where: {
        organizationId,
        active: true,
        effectiveFrom: { lte: new Date() },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }],
      },
      select: { id: true },
    });
    if (!route) return null;
    const idempotencyKey = `profit:${scanJobId}:${policy.engineVersion}:${policy.updatedAt.toISOString()}`;
    const run = await transaction.profitCalculationRun.upsert({
      where: {
        organizationId_idempotencyKey: { organizationId, idempotencyKey },
      },
      create: {
        organizationId,
        scanJobId,
        financialPolicyId: policy.id,
        idempotencyKey,
        status: "PENDING",
        attemptCount: 1,
      },
      update: {
        status: "PENDING",
        completedAt: null,
        attemptCount: { increment: 1 },
      },
    });
    await transaction.scanJob.update({
      where: { id: scanJobId },
      data: { status: "CALCULATING", completedAt: null },
    });
    // A calculation run is the idempotency boundary. A scan can have a full
    // calculation and later targeted recalculations in flight.
    await transaction.outboxEvent.upsert({
      where: {
        scanJobId_eventType: {
          scanJobId,
          eventType: `scan.calculate.requested.${run.id}`,
        },
      },
      create: {
        organizationId,
        scanJobId,
        eventType: `scan.calculate.requested.${run.id}`,
        payload: {
          scanJobId,
          runId: run.id,
          kind: "CALCULATE",
          runAttempt: run.attemptCount,
        },
      },
      update: {
        status: "PENDING",
        claimToken: null,
        claimedAt: null,
        lastError: null,
        payload: {
          scanJobId,
          runId: run.id,
          kind: "CALCULATE",
          runAttempt: run.attemptCount,
        },
      },
    });
    return run;
  });
}

export async function getProfitCalculationForProcessing(runId: string) {
  const run = await db.profitCalculationRun.findFirst({
    where: {
      id: runId,
      status: { in: ["PENDING", "FAILED_RETRYABLE"] },
    },
    orderBy: { createdAt: "desc" },
    include: {
      financialPolicy: true,
      organization: { select: { brandPolicies: true } },
      targets: true,
      scanJob: {
        select: { id: true },
      },
    },
  });
  if (!run) return null;
  const supplierRows = await db.supplierRow.findMany({
    where: {
      scanJobId: run.scanJobId,
      ...(run.scope === "TARGETED"
        ? { id: { in: run.targets.map((target) => target.supplierRowId) } }
        : {}),
    },
    orderBy: { sourceRowNumber: "asc" },
    include: {
      normalizedOffer: true,
      matchDecision: {
        include: {
          selectedCandidate: {
            include: { catalogProduct: true, packGuard: true },
          },
        },
      },
      enrichmentItems: { include: { observations: true } },
      profitCostOverrides: { include: { values: true } },
    },
  });
  const routes = await db.shippingRoute.findMany({
    where: {
      organizationId: run.organizationId,
      active: true,
      effectiveFrom: { lte: new Date() },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }],
    },
    orderBy: { effectiveFrom: "desc" },
  });
  return { ...run, scanJob: { ...run.scanJob, supplierRows }, routes };
}

export async function markProfitCalculationRunning(runId: string) {
  const run = await db.profitCalculationRun.findFirst({
    where: { id: runId, status: { in: ["PENDING", "FAILED_RETRYABLE"] } },
    select: { id: true },
  });
  if (!run) return false;
  await db.profitCalculationRun.update({
    where: { id: runId },
    data: { status: "RUNNING" },
  });
  return true;
}

export async function failProfitCalculation(
  runId: string,
  status: "FAILED_RETRYABLE" | "FAILED_FINAL",
) {
  await db.$transaction(async (transaction) => {
    const run = await transaction.profitCalculationRun.findFirst({
      where: { id: runId, status: { in: ["PENDING", "RUNNING"] } },
      select: { scanJobId: true, scope: true },
    });
    if (!run) return;
    await transaction.profitCalculationRun.update({
      where: { id: runId },
      data: { status },
    });
    await transaction.profitCostOverride.updateMany({
      where: { calculationRunId: runId },
      data: { status: "FAILED" },
    });
    if (run.scope === "FULL") {
      await transaction.scanJob.update({
        where: { id: run.scanJobId },
        data: { status },
      });
      await transaction.scanEvent.create({
        data: {
          scanJobId: run.scanJobId,
          eventType: status,
          payload: { message: "profit_calculation_failed", runId },
        },
      });
    }
  });
}

export function shouldPromoteProfitResult(input: {
  appliedOverrideRevision?: number | undefined;
  currentOverride?:
    { revision: number; calculationRunId: string | null } | null | undefined;
  runId: string;
}): boolean {
  if (!input.currentOverride)
    return input.appliedOverrideRevision === undefined;
  return (
    input.currentOverride?.revision === input.appliedOverrideRevision &&
    input.currentOverride.calculationRunId === input.runId
  );
}

export async function persistProfitCalculation(input: {
  organizationId: string;
  runId: string;
  results: Array<{
    supplierRowId: string;
    shippingRouteId: string;
    status: "COMPLETED" | "PARTIAL_SUCCESS";
    recommendation?: ProductRecommendation;
    currentNetProfit?: string;
    conservativeNetProfit?: string;
    stressNetProfit?: string;
    effectiveCogs?: string;
    amazonFees?: string;
    roiPercent?: string;
    marginPercent?: string;
    breakEvenPrice?: string;
    engineVersion: string;
    inputSnapshot: Prisma.InputJsonValue;
    evidence: Prisma.InputJsonValue;
    reasonCodes: Prisma.InputJsonValue;
    appliedOverrideRevision?: number;
  }>;
  status: "COMPLETED" | "PARTIAL_SUCCESS";
}) {
  await db.$transaction(
    async (transaction) => {
      const run = await transaction.profitCalculationRun.findFirst({
        where: { id: input.runId, organizationId: input.organizationId },
        select: { id: true, scanJobId: true, scope: true },
      });
      if (!run) return;
      const supplierRowIds = [
        ...new Set(input.results.map((result) => result.supplierRowId)),
      ];
      const shippingRouteIds = [
        ...new Set(input.results.map((result) => result.shippingRouteId)),
      ];
      const overrides = await transaction.profitCostOverride.findMany({
        where: {
          organizationId: input.organizationId,
          supplierRowId: { in: supplierRowIds },
          shippingRouteId: { in: shippingRouteIds },
        },
        select: {
          supplierRowId: true,
          shippingRouteId: true,
          revision: true,
          calculationRunId: true,
        },
      });
      const overrideByPair = new Map(
        overrides.map((override) => [
          `${override.supplierRowId}:${override.shippingRouteId}`,
          override,
        ]),
      );
      const promotable = input.results.filter((result) =>
        shouldPromoteProfitResult({
          appliedOverrideRevision: result.appliedOverrideRevision,
          currentOverride: overrideByPair.get(
            `${result.supplierRowId}:${result.shippingRouteId}`,
          ),
          runId: input.runId,
        }),
      );
      const rowsByRoute = new Map<string, string[]>();
      for (const result of promotable) {
        const rows = rowsByRoute.get(result.shippingRouteId) ?? [];
        rows.push(result.supplierRowId);
        rowsByRoute.set(result.shippingRouteId, rows);
      }
      for (const [shippingRouteId, rowIds] of rowsByRoute) {
        await transaction.profitResult.updateMany({
          where: {
            organizationId: input.organizationId,
            scanJobId: run.scanJobId,
            supplierRowId: { in: rowIds },
            shippingRouteId,
            isCurrent: true,
          },
          data: { isCurrent: false },
        });
      }
      await transaction.profitResult.deleteMany({
        where: { profitCalculationRunId: input.runId },
      });
      const resultRows = promotable.map((result) => ({
        ...result,
        organizationId: input.organizationId,
        scanJobId: run.scanJobId,
        profitCalculationRunId: input.runId,
        isCurrent: true,
      }));
      for (let offset = 0; offset < resultRows.length; offset += 500) {
        await transaction.profitResult.createMany({
          data: resultRows.slice(offset, offset + 500),
        });
      }
      await transaction.profitCalculationRun.update({
        where: { id: input.runId },
        data: { status: input.status, completedAt: new Date() },
      });
      if (run.scope === "FULL") {
        await transaction.scanJob.update({
          where: { id: run.scanJobId },
          data: {
            status:
              input.status === "COMPLETED" ? "COMPLETED" : "PARTIAL_SUCCESS",
            completedAt: new Date(),
          },
        });
      }
      await transaction.profitCostOverride.updateMany({
        where: { calculationRunId: input.runId },
        data: { status: "APPLIED" },
      });
      await transaction.scanCheckpoint.upsert({
        where: {
          scanJobId_stage: { scanJobId: run.scanJobId, stage: "CALCULATE" },
        },
        create: {
          scanJobId: run.scanJobId,
          stage: "CALCULATE",
          checksum: `${input.runId}:${input.results.length}`,
          payload: {
            runId: input.runId,
            status: input.status,
            resultCount: input.results.length,
          },
        },
        update: {
          checksum: `${input.runId}:${input.results.length}`,
          payload: {
            runId: input.runId,
            status: input.status,
            resultCount: input.results.length,
          },
        },
      });
    },
    { timeout: 60_000 },
  );
}

export async function listProfitResultsForScan(
  organizationId: string,
  scanJobId: string,
) {
  return db.profitResult.findMany({
    where: {
      organizationId,
      profitCalculationRun: { scanJobId, organizationId },
    },
    include: {
      shippingRoute: {
        select: { name: true, currency: true, effectiveFrom: true },
      },
      supplierRow: { select: { sourceRowNumber: true } },
    },
    orderBy: [
      { supplierRow: { sourceRowNumber: "asc" } },
      { updatedAt: "desc" },
    ],
  });
}

type AnalysisFilters = {
  recommendation?: ProductRecommendation | undefined;
  search?: string | undefined;
  minRoiPercent?: string | undefined;
  maxRoiPercent?: string | undefined;
  status?: "COMPLETED" | "PARTIAL_SUCCESS" | undefined;
};

type AnalysisSort =
  | "sourceRowNumber"
  | "recommendation"
  | "conservativeNetProfit"
  | "roiPercent"
  | "marginPercent"
  | "breakEvenPrice";

function analysisWhere(
  organizationId: string,
  scanJobId: string,
  shippingRouteId: string,
  filters: AnalysisFilters,
): Prisma.ProfitResultWhereInput {
  const search = filters.search?.trim();
  return {
    organizationId,
    scanJobId,
    shippingRouteId,
    isCurrent: true,
    ...(filters.recommendation
      ? { recommendation: filters.recommendation }
      : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.minRoiPercent
      ? { roiPercent: { gte: filters.minRoiPercent } }
      : {}),
    ...(filters.maxRoiPercent
      ? { roiPercent: { lte: filters.maxRoiPercent } }
      : {}),
    ...(search
      ? {
          OR: [
            {
              supplierRow: {
                normalizedOffer: {
                  asin: { contains: search, mode: "insensitive" },
                },
              },
            },
            {
              supplierRow: {
                matchDecision: {
                  selectedCandidate: {
                    catalogProduct: {
                      asin: { contains: search, mode: "insensitive" },
                    },
                  },
                },
              },
            },
            {
              supplierRow: {
                normalizedOffer: {
                  itemNumber: { contains: search, mode: "insensitive" },
                },
              },
            },
            {
              supplierRow: {
                normalizedOffer: {
                  description: { contains: search, mode: "insensitive" },
                },
              },
            },
            {
              supplierRow: {
                normalizedOffer: {
                  brand: { contains: search, mode: "insensitive" },
                },
              },
            },
          ],
        }
      : {}),
  };
}

function analysisOrderBy(
  sort: AnalysisSort,
  direction: "asc" | "desc",
): Prisma.ProfitResultOrderByWithRelationInput[] {
  if (sort === "sourceRowNumber")
    return [{ supplierRow: { sourceRowNumber: direction } }, { id: "asc" }];
  if (sort === "recommendation")
    return [{ recommendation: direction }, { id: "asc" }];
  return [{ [sort]: direction }, { id: "asc" }];
}

export async function listAnalysisResults(input: {
  organizationId: string;
  scanJobId: string;
  shippingRouteId?: string;
  offset: number;
  limit: number;
  filters: AnalysisFilters;
  sort: AnalysisSort;
  direction: "asc" | "desc";
}) {
  const scan = await db.scanJob.findFirst({
    where: { id: input.scanJobId, organizationId: input.organizationId },
    select: {
      id: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      completedAt: true,
      supplier: { select: { code: true, name: true } },
      upload: { select: { originalFilename: true, status: true } },
      checkpoints: {
        select: { stage: true, updatedAt: true },
        orderBy: { createdAt: "asc" },
      },
      events: {
        where: {
          eventType: { in: ["FAILED_RETRYABLE", "FAILED_FINAL"] },
        },
        select: { eventType: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 3,
      },
      _count: { select: { supplierRows: true } },
    },
  });
  if (!scan) return null;
  const context = {
    id: scan.id,
    status: scan.status,
    createdAt: scan.createdAt.toISOString(),
    updatedAt: scan.updatedAt.toISOString(),
    completedAt: scan.completedAt?.toISOString() ?? null,
    supplier: scan.supplier,
    upload: scan.upload,
    rowCount: scan._count.supplierRows,
    checkpoints: scan.checkpoints.map((checkpoint) => ({
      stage: checkpoint.stage,
      updatedAt: checkpoint.updatedAt.toISOString(),
    })),
    recoverableErrors: scan.events.map((event) => ({
      status: event.eventType,
      observedAt: event.createdAt.toISOString(),
    })),
  };
  let shippingRouteId: string | undefined;
  if (input.shippingRouteId) {
    const route = await db.shippingRoute.findFirst({
      where: {
        id: input.shippingRouteId,
        organizationId: input.organizationId,
      },
      select: { id: true },
    });
    shippingRouteId = route?.id;
  } else {
    const route = await db.profitResult.findFirst({
      where: {
        organizationId: input.organizationId,
        scanJobId: input.scanJobId,
        isCurrent: true,
      },
      select: { shippingRouteId: true },
      orderBy: { updatedAt: "desc" },
    });
    shippingRouteId = route?.shippingRouteId;
  }
  if (!shippingRouteId) {
    const currentResultCount = await db.profitResult.count({
      where: {
        organizationId: input.organizationId,
        scanJobId: input.scanJobId,
        isCurrent: true,
      },
    });
    return {
      total: 0,
      unfilteredTotal: currentResultCount,
      rows: [],
      routes: [],
      context,
    };
  }
  const where = analysisWhere(
    input.organizationId,
    input.scanJobId,
    shippingRouteId,
    input.filters,
  );
  const [total, unfilteredTotal, rows, routes] = await db.$transaction([
    db.profitResult.count({ where }),
    db.profitResult.count({
      where: {
        organizationId: input.organizationId,
        scanJobId: input.scanJobId,
        shippingRouteId,
        isCurrent: true,
      },
    }),
    db.profitResult.findMany({
      where,
      skip: input.offset,
      take: input.limit,
      orderBy: analysisOrderBy(input.sort, input.direction),
      select: {
        id: true,
        status: true,
        recommendation: true,
        currentNetProfit: true,
        conservativeNetProfit: true,
        stressNetProfit: true,
        effectiveCogs: true,
        amazonFees: true,
        roiPercent: true,
        marginPercent: true,
        breakEvenPrice: true,
        reasonCodes: true,
        supplierRow: {
          select: {
            sourceRowNumber: true,
            normalizedOffer: {
              select: {
                asin: true,
                itemNumber: true,
                description: true,
                brand: true,
                unitCost: true,
                currency: true,
                quantity: true,
                caseCount: true,
                packCount: true,
              },
            },
            warnings: { select: { code: true, severity: true } },
            matchDecision: {
              select: {
                status: true,
                confidence: true,
                selectedCandidate: {
                  select: {
                    catalogProduct: {
                      select: {
                        asin: true,
                        title: true,
                        brand: true,
                        provider: true,
                        observedAt: true,
                        freshnessState: true,
                        packCount: true,
                      },
                    },
                    packGuard: { select: { status: true, reasonCode: true } },
                  },
                },
              },
            },
            enrichmentItems: {
              select: {
                observations: {
                  select: {
                    metricType: true,
                    provider: true,
                    observedAt: true,
                    freshUntil: true,
                    freshnessState: true,
                    primaryAmount: true,
                    currency: true,
                    payload: true,
                  },
                },
              },
            },
            profitCostOverrides: {
              where: { organizationId: input.organizationId, shippingRouteId },
              select: {
                revision: true,
                status: true,
                stressDiscountPercent: true,
                values: { select: { field: true, value: true } },
              },
            },
          },
        },
      },
    }),
    db.shippingRoute.findMany({
      where: {
        organizationId: input.organizationId,
        profitResults: {
          some: { scanJobId: input.scanJobId, isCurrent: true },
        },
      },
      select: { id: true, name: true, currency: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const projectedRows = rows.map((row) => {
    const observations = row.supplierRow.enrichmentItems.flatMap(
      (item) => item.observations,
    );
    const external = (metricType: "PRICING" | "FEES" | "RESTRICTIONS") => {
      const observation = observations
        .filter((candidate) => candidate.metricType === metricType)
        .sort(
          (left, right) =>
            right.observedAt.getTime() - left.observedAt.getTime(),
        )[0];
      if (!observation) return null;
      const restrictionValue = (
        observation.payload as { value?: { status?: unknown } }
      ).value?.status;
      return {
        provider: observation.provider,
        observedAt: observation.observedAt.toISOString(),
        freshUntil: observation.freshUntil.toISOString(),
        freshnessState: observation.freshnessState,
        value: observation.primaryAmount?.toString() ?? null,
        currency: observation.currency,
        restrictionStatus:
          metricType === "RESTRICTIONS" && typeof restrictionValue === "string"
            ? restrictionValue
            : null,
      };
    };
    const { enrichmentItems, ...supplierRow } = row.supplierRow;
    void enrichmentItems;
    return {
      ...row,
      supplierRow,
      externalEvidence: {
        pricing: external("PRICING"),
        fees: external("FEES"),
        restrictions: external("RESTRICTIONS"),
      },
    };
  });
  return {
    total,
    unfilteredTotal,
    rows: projectedRows,
    routes,
    shippingRouteId,
    context,
  };
}

export async function getAnalysisResult(
  organizationId: string,
  resultId: string,
) {
  const result = await db.profitResult.findFirst({
    where: { id: resultId, organizationId },
    include: {
      shippingRoute: true,
      supplierRow: {
        include: {
          normalizedOffer: true,
          warnings: true,
          matchDecision: {
            include: {
              selectedCandidate: {
                include: {
                  catalogProduct: {
                    select: {
                      asin: true,
                      title: true,
                      brand: true,
                      model: true,
                      mpn: true,
                      sizeText: true,
                      packCount: true,
                      variation: true,
                      provider: true,
                      providerReference: true,
                      observedAt: true,
                      freshnessState: true,
                      marketplaceId: true,
                      responseCompleteness: true,
                      requestLineage: true,
                      identityProjection: true,
                    },
                  },
                  evidence: true,
                  packGuard: true,
                },
              },
            },
          },
          listingCandidates: {
            include: {
              catalogProduct: {
                select: {
                  asin: true,
                  title: true,
                  brand: true,
                  model: true,
                  mpn: true,
                  sizeText: true,
                  packCount: true,
                  variation: true,
                  provider: true,
                  providerReference: true,
                  observedAt: true,
                  freshnessState: true,
                  marketplaceId: true,
                  responseCompleteness: true,
                  requestLineage: true,
                  identityProjection: true,
                },
              },
              evidence: true,
              packGuard: true,
            },
            orderBy: { confidence: "desc" },
          },
          enrichmentItems: { include: { observations: true } },
          profitCostOverrides: {
            include: {
              values: true,
              events: { orderBy: { createdAt: "desc" } },
            },
          },
          profitResults: {
            where: { isCurrent: true },
            include: {
              shippingRoute: { select: { name: true, currency: true } },
            },
          },
        },
      },
    },
  });
  if (!result) return null;
  const auditEvents = await db.workflowAuditEvent.findMany({
    where: {
      organizationId,
      entityId: {
        in: [
          result.id,
          result.supplierRowId,
          ...(result.supplierRow.matchDecision?.id
            ? [result.supplierRow.matchDecision.id]
            : []),
        ],
      },
    },
    orderBy: { createdAt: "asc" },
  });
  return { ...result, auditEvents };
}

export async function getAnalysisOverrideForResult(
  organizationId: string,
  resultId: string,
) {
  return db.profitResult.findFirst({
    where: { id: resultId, organizationId, isCurrent: true },
    select: {
      id: true,
      supplierRowId: true,
      shippingRouteId: true,
      supplierRow: {
        select: {
          profitCostOverrides: {
            where: { organizationId },
            select: {
              shippingRouteId: true,
              revision: true,
              stressDiscountPercent: true,
              values: { select: { field: true, value: true } },
            },
          },
        },
      },
    },
  });
}

export async function listAnalysisViews(
  organizationId: string,
  scanJobId: string,
) {
  return db.analysisView.findMany({
    where: { organizationId, OR: [{ scanJobId }, { scanJobId: null }] },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
  });
}

export async function saveAnalysisView(input: {
  organizationId: string;
  scanJobId: string;
  name: string;
  queryState: Prisma.InputJsonValue;
  isDefault?: boolean | undefined;
}) {
  return db.$transaction(async (transaction) => {
    const scan = await transaction.scanJob.findFirst({
      where: { id: input.scanJobId, organizationId: input.organizationId },
      select: { id: true },
    });
    if (!scan) throw new Error("SCAN_NOT_FOUND");
    if (input.isDefault)
      await transaction.analysisView.updateMany({
        where: {
          organizationId: input.organizationId,
          scanJobId: input.scanJobId,
        },
        data: { isDefault: false },
      });
    return transaction.analysisView.upsert({
      where: {
        organizationId_scanJobId_name: {
          organizationId: input.organizationId,
          scanJobId: input.scanJobId,
          name: input.name,
        },
      },
      create: {
        organizationId: input.organizationId,
        scanJobId: input.scanJobId,
        name: input.name,
        queryState: input.queryState,
        schemaVersion: 1,
        isDefault: input.isDefault ?? false,
      },
      update: {
        queryState: input.queryState,
        isDefault: input.isDefault ?? false,
      },
    });
  });
}

export async function deleteAnalysisView(
  organizationId: string,
  viewId: string,
) {
  return db.analysisView.deleteMany({ where: { id: viewId, organizationId } });
}

const OVERRIDE_FIELD_TO_COST: Record<CostOverrideField, string> = {
  SUPPLIER_COST_PER_SELLABLE_UNIT: "supplierCostPerSellableUnit",
  ALLOCATED_SUPPLIER_FREIGHT: "allocatedSupplierFreight",
  PREP_FEE: "prepFee",
  LABELING_FEE: "labelingFee",
  POLYBAG_FEE: "polybagFee",
  BUNDLE_FEE: "bundleFee",
  BUBBLEWRAP_FEE: "bubblewrapFee",
  INBOUND_SHIPPING: "inboundShipping",
  DUTY_OR_TAX: "dutyOrTax",
  STORAGE_ALLOWANCE: "storageAllowance",
  RETURN_ALLOWANCE: "returnAllowance",
  OTHER_COSTS: "otherCosts",
};

export { OVERRIDE_FIELD_TO_COST };

export async function queueAnalysisRecalculation(input: {
  organizationId: string;
  resultId: string;
  idempotencyKey: string;
}) {
  return db.$transaction(async (transaction) => {
    const result = await transaction.profitResult.findFirst({
      where: {
        id: input.resultId,
        organizationId: input.organizationId,
        isCurrent: true,
      },
      select: { scanJobId: true, supplierRowId: true, shippingRouteId: true },
    });
    const policy = await transaction.financialPolicy.findUnique({
      where: { organizationId: input.organizationId },
      select: { id: true },
    });
    if (!result || !policy) return null;
    const idempotencyKey = `analysis-recalculate:${input.idempotencyKey}`;
    const existing = await transaction.profitCalculationRun.findUnique({
      where: {
        organizationId_idempotencyKey: {
          organizationId: input.organizationId,
          idempotencyKey,
        },
      },
      select: { id: true },
    });
    const run = await transaction.profitCalculationRun.upsert({
      where: {
        organizationId_idempotencyKey: {
          organizationId: input.organizationId,
          idempotencyKey,
        },
      },
      create: {
        organizationId: input.organizationId,
        scanJobId: result.scanJobId,
        financialPolicyId: policy.id,
        idempotencyKey,
        scope: "TARGETED",
        requestChecksum: `${result.supplierRowId}:${result.shippingRouteId}:recalculate`,
        status: "PENDING",
        attemptCount: 1,
        targets: {
          create: {
            supplierRowId: result.supplierRowId,
            shippingRouteId: result.shippingRouteId,
          },
        },
      },
      update: {},
    });
    await transaction.outboxEvent.upsert({
      where: {
        scanJobId_eventType: {
          scanJobId: result.scanJobId,
          eventType: `scan.calculate.requested.${run.id}`,
        },
      },
      create: {
        organizationId: input.organizationId,
        scanJobId: result.scanJobId,
        eventType: `scan.calculate.requested.${run.id}`,
        payload: {
          scanJobId: result.scanJobId,
          runId: run.id,
          kind: "CALCULATE",
          runAttempt: 1,
        },
      },
      update: {},
    });
    return { run, duplicate: Boolean(existing) };
  });
}

export async function applyAnalysisOverride(input: {
  organizationId: string;
  resultId: string;
  expectedRevision: number;
  idempotencyKey: string;
  reason: string;
  values: Array<{ field: CostOverrideField; value: string | null }>;
  stressDiscountPercent?: string | null | undefined;
}) {
  return db.$transaction(async (transaction) => {
    const result = await transaction.profitResult.findFirst({
      where: {
        id: input.resultId,
        organizationId: input.organizationId,
        isCurrent: true,
      },
      select: { scanJobId: true, supplierRowId: true, shippingRouteId: true },
    });
    const policy = await transaction.financialPolicy.findUnique({
      where: { organizationId: input.organizationId },
    });
    if (!result || !policy) return null;
    const existingEvent = await transaction.profitCostOverrideEvent.findFirst({
      where: {
        organizationId: input.organizationId,
        idempotencyKey: input.idempotencyKey,
      },
      include: { override: true },
    });
    if (existingEvent) {
      if (
        existingEvent.override.supplierRowId !== result.supplierRowId ||
        existingEvent.override.shippingRouteId !== result.shippingRouteId
      )
        throw new Error("IDEMPOTENCY_KEY_TARGET_MISMATCH");
      return { override: existingEvent.override, duplicate: true };
    }
    const existing = await transaction.profitCostOverride.findUnique({
      where: {
        organizationId_supplierRowId_shippingRouteId: {
          organizationId: input.organizationId,
          supplierRowId: result.supplierRowId,
          shippingRouteId: result.shippingRouteId,
        },
      },
      include: { values: true },
    });
    if (existing && existing.revision !== input.expectedRevision)
      throw new Error("OVERRIDE_REVISION_CONFLICT");
    const nextRevision = (existing?.revision ?? 0) + 1;
    const nextValues = new Map<CostOverrideField, string>(
      existing?.values.map((value) => [value.field, value.value.toString()]) ??
        [],
    );
    for (const value of input.values) {
      if (value.value === null) nextValues.delete(value.field);
      else nextValues.set(value.field, value.value);
    }
    const checksum = `${result.supplierRowId}:${result.shippingRouteId}:${nextRevision}`;
    const run = await transaction.profitCalculationRun.create({
      data: {
        organizationId: input.organizationId,
        scanJobId: result.scanJobId,
        financialPolicyId: policy.id,
        idempotencyKey: `analysis:${input.idempotencyKey}`,
        scope: "TARGETED",
        requestChecksum: checksum,
        status: "PENDING",
        attemptCount: 1,
        targets: {
          create: {
            supplierRowId: result.supplierRowId,
            shippingRouteId: result.shippingRouteId,
          },
        },
      },
    });
    const override = existing
      ? await transaction.profitCostOverride.update({
          where: { id: existing.id },
          data: {
            revision: nextRevision,
            reason: input.reason,
            status: "PENDING_RECALCULATION",
            calculationRunId: run.id,
            stressDiscountPercent:
              input.stressDiscountPercent === undefined
                ? (existing.stressDiscountPercent?.toString() ?? null)
                : input.stressDiscountPercent,
            values: {
              deleteMany: {},
              create: [...nextValues].map(([field, value]) => ({
                field: field as never,
                value,
              })),
            },
          },
        })
      : await transaction.profitCostOverride.create({
          data: {
            organizationId: input.organizationId,
            scanJobId: result.scanJobId,
            supplierRowId: result.supplierRowId,
            shippingRouteId: result.shippingRouteId,
            revision: nextRevision,
            reason: input.reason,
            stressDiscountPercent: input.stressDiscountPercent ?? null,
            calculationRunId: run.id,
            values: {
              create: [...nextValues].map(([field, value]) => ({
                field: field as never,
                value,
              })),
            },
          },
        });
    await transaction.profitCostOverrideEvent.create({
      data: {
        overrideId: override.id,
        organizationId: input.organizationId,
        revision: nextRevision,
        idempotencyKey: input.idempotencyKey,
        reason: input.reason,
        previousValues: Object.fromEntries(
          existing?.values.map((value) => [
            value.field,
            value.value.toString(),
          ]) ?? [],
        ),
        nextValues: Object.fromEntries(nextValues),
      },
    });
    await transaction.outboxEvent.create({
      data: {
        organizationId: input.organizationId,
        scanJobId: result.scanJobId,
        eventType: `scan.calculate.requested.${run.id}`,
        payload: {
          scanJobId: result.scanJobId,
          runId: run.id,
          kind: "CALCULATE",
          runAttempt: 1,
        },
      },
    });
    return { override, run, duplicate: false };
  });
}

function stringOrNull(
  value: string | number | null | undefined,
): string | null {
  return typeof value === "string"
    ? value
    : value == null
      ? null
      : String(value);
}

function integerOrNull(
  value: string | number | null | undefined,
): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

function decimalOrNull(
  value: string | number | null | undefined,
): string | null {
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) return value;
  return null;
}

const OUTBOX_CLAIM_LEASE_MS = 60_000;
const OUTBOX_PUBLISHED_RECONCILE_MS = 60_000;

export type ClaimedOutboxEvent = {
  id: string;
  payload: Prisma.JsonValue;
  claimToken: string;
};

/**
 * Redis is transport, not truth. A published event may disappear with Redis
 * before its deterministic job runs, so periodically make unfinished targets
 * eligible for another idempotent enqueue.
 */
export async function recoverPublishedOutboxEvents(
  limit: number,
): Promise<number> {
  const staleBefore = new Date(Date.now() - OUTBOX_PUBLISHED_RECONCILE_MS);
  const events = await db.outboxEvent.findMany({
    where: {
      status: "PUBLISHED",
      publishedAt: { lt: staleBefore },
      OR: [
        {
          scanJob: {
            is: {
              status: {
                notIn: ["COMPLETED", "PARTIAL_SUCCESS", "FAILED_FINAL"],
              },
            },
          },
        },
        {
          exportJob: {
            is: { status: { notIn: ["COMPLETED", "FAILED_FINAL"] } },
          },
        },
      ],
    },
    select: { id: true },
    orderBy: { publishedAt: "asc" },
    take: limit,
  });
  if (events.length === 0) return 0;
  const result = await db.outboxEvent.updateMany({
    where: { id: { in: events.map((event) => event.id) }, status: "PUBLISHED" },
    data: {
      status: "PENDING",
      claimToken: null,
      claimedAt: null,
      lastError: "published_event_reconciled",
    },
  });
  return result.count;
}

export async function claimPendingOutboxEvents(
  limit: number,
): Promise<ClaimedOutboxEvent[]> {
  const staleBefore = new Date(Date.now() - OUTBOX_CLAIM_LEASE_MS);
  await db.outboxEvent.updateMany({
    where: {
      status: "PROCESSING",
      OR: [{ claimedAt: { lt: staleBefore } }, { claimedAt: null }],
    },
    data: { status: "PENDING", claimToken: null, claimedAt: null },
  });

  const events = await db.outboxEvent.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  const claimed: ClaimedOutboxEvent[] = [];
  for (const event of events) {
    const claimToken = randomUUID();
    const result = await db.outboxEvent.updateMany({
      where: { id: event.id, status: "PENDING" },
      data: {
        status: "PROCESSING",
        claimToken,
        claimedAt: new Date(),
        deliveryAttempts: { increment: 1 },
        lastError: null,
      },
    });
    if (result.count === 1)
      claimed.push({ id: event.id, payload: event.payload, claimToken });
  }
  return claimed;
}

export async function markOutboxPublished(
  outboxEventId: string,
  claimToken: string,
): Promise<boolean> {
  const result = await db.outboxEvent.updateMany({
    where: { id: outboxEventId, status: "PROCESSING", claimToken },
    data: {
      status: "PUBLISHED",
      publishedAt: new Date(),
      claimToken: null,
      claimedAt: null,
    },
  });
  return result.count === 1;
}

export async function resetOutboxEvent(
  outboxEventId: string,
  claimToken: string,
  lastError: string,
): Promise<boolean> {
  const result = await db.outboxEvent.updateMany({
    where: { id: outboxEventId, status: "PROCESSING", claimToken },
    data: {
      status: "PENDING",
      claimToken: null,
      claimedAt: null,
      lastError,
    },
  });
  return result.count === 1;
}

export async function markScanJobRunning(scanJobId: string): Promise<boolean> {
  return db.$transaction(async (transaction) => {
    const updated = await transaction.scanJob.updateMany({
      where: {
        id: scanJobId,
        status: { in: ["QUEUED", "RUNNING", "FAILED_RETRYABLE"] },
      },
      data: { status: "RUNNING", attemptCount: { increment: 1 } },
    });
    if (updated.count === 0) return false;
    await transaction.scanEvent.create({
      data: { scanJobId, eventType: "RUNNING" },
    });
    return true;
  });
}

export async function completeMockScanJob(
  scanJobId: string,
  checksum: string,
  result: Prisma.InputJsonValue,
) {
  await db.$transaction(async (transaction) => {
    const completed = await transaction.scanJob.updateMany({
      where: { id: scanJobId, status: "RUNNING" },
      data: {
        status: "COMPLETED",
        mockResult: result,
        completedAt: new Date(),
      },
    });
    if (completed.count === 0) return;
    await transaction.scanCheckpoint.upsert({
      where: { scanJobId_stage: { scanJobId, stage: "MOCK_SCAN" } },
      create: { scanJobId, stage: "MOCK_SCAN", checksum, payload: result },
      update: { checksum, payload: result },
    });
    await transaction.scanEvent.create({
      data: { scanJobId, eventType: "COMPLETED", payload: result },
    });
  });
}

export async function failScanJob(
  scanJobId: string,
  status: Extract<ScanJobStatus, "FAILED_RETRYABLE" | "FAILED_FINAL">,
  message: string,
) {
  await db.$transaction(async (transaction) => {
    await transaction.scanJob.update({
      where: { id: scanJobId },
      data: { status },
    });
    await transaction.scanEvent.create({
      data: { scanJobId, eventType: status, payload: { message } },
    });
  });
}

// Phase 6 workflow repositories. These deliberately accept an organization context on
// every call so nested identifiers cannot become a cross-tenant access path.
export async function createShortlist(input: {
  organizationId: string;
  name: string;
  description?: string;
  idempotencyKey: string;
}) {
  return db.$transaction(async (transaction) => {
    const existing = await transaction.workflowAuditEvent.findFirst({
      where: {
        organizationId: input.organizationId,
        idempotencyKey: input.idempotencyKey,
      },
      select: { entityId: true },
    });
    if (existing)
      return transaction.shortlist.findFirst({
        where: { id: existing.entityId, organizationId: input.organizationId },
      });
    const shortlist = await transaction.shortlist.create({
      data: {
        organizationId: input.organizationId,
        name: input.name,
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
      },
    });
    await transaction.workflowAuditEvent.create({
      data: {
        organizationId: input.organizationId,
        entityType: "SHORTLIST",
        entityId: shortlist.id,
        eventType: "CREATED",
        idempotencyKey: input.idempotencyKey,
      },
    });
    return shortlist;
  });
}

export async function listShortlists(organizationId: string) {
  return db.shortlist.findMany({
    where: { organizationId },
    include: { _count: { select: { items: true } } },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getShortlistForOrganization(
  organizationId: string,
  shortlistId: string,
) {
  return db.shortlist.findFirst({
    where: { id: shortlistId, organizationId },
    include: {
      items: {
        include: {
          notes: { orderBy: { createdAt: "asc" } },
          profitResult: {
            include: {
              shippingRoute: true,
              supplierRow: {
                include: {
                  normalizedOffer: true,
                  matchDecision: {
                    include: {
                      selectedCandidate: {
                        include: { packGuard: true, catalogProduct: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
}

export async function addShortlistItems(input: {
  organizationId: string;
  shortlistId: string;
  resultIds: string[];
  idempotencyKey: string;
}) {
  return db.$transaction(async (transaction) => {
    const fingerprint = requestFingerprint({
      shortlistId: input.shortlistId,
      resultIds: [...input.resultIds].sort(),
    });
    const previous = await transaction.workflowAuditEvent.findUnique({
      where: {
        organizationId_idempotencyKey: {
          organizationId: input.organizationId,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (previous) {
      assertIdempotentEvent(previous, {
        entityType: "SHORTLIST",
        entityId: input.shortlistId,
        eventType: "ITEMS_ADDED",
        fingerprint,
      });
      const itemIds = auditPayload(previous.payload).itemIds;
      if (
        !Array.isArray(itemIds) ||
        !itemIds.every((id) => typeof id === "string")
      )
        throw new Error("IDEMPOTENCY_EVENT_INVALID");
      return transaction.shortlistItem.findMany({
        where: { id: { in: itemIds }, organizationId: input.organizationId },
      });
    }
    const shortlist = await transaction.shortlist.findFirst({
      where: { id: input.shortlistId, organizationId: input.organizationId },
    });
    if (!shortlist) return null;
    const results = await transaction.profitResult.findMany({
      where: {
        id: { in: input.resultIds },
        organizationId: input.organizationId,
        isCurrent: true,
      },
      select: { id: true, supplierRowId: true },
    });
    if (results.length !== new Set(input.resultIds).size)
      throw new Error("RESULT_NOT_FOUND");
    const items = [];
    for (const result of results)
      items.push(
        await transaction.shortlistItem.upsert({
          where: {
            shortlistId_supplierRowId: {
              shortlistId: shortlist.id,
              supplierRowId: result.supplierRowId,
            },
          },
          create: {
            organizationId: input.organizationId,
            shortlistId: shortlist.id,
            supplierRowId: result.supplierRowId,
            profitResultId: result.id,
          },
          update: { profitResultId: result.id },
        }),
      );
    await transaction.shortlist.update({
      where: { id: shortlist.id },
      data: { revision: { increment: 1 } },
    });
    await transaction.workflowAuditEvent.create({
      data: {
        organizationId: input.organizationId,
        entityType: "SHORTLIST",
        entityId: shortlist.id,
        eventType: "ITEMS_ADDED",
        idempotencyKey: input.idempotencyKey,
        payload: {
          fingerprint,
          resultIds: input.resultIds,
          itemIds: items.map((item) => item.id),
        },
      },
    });
    return items;
  });
}

export async function transitionShortlistItems(input: {
  organizationId: string;
  shortlistId: string;
  itemIds: string[];
  status: string;
  ownerReference?: string | null;
  expectedRevision?: number;
  idempotencyKey: string;
}) {
  return db.$transaction(async (transaction) => {
    const fingerprint = requestFingerprint({
      shortlistId: input.shortlistId,
      itemIds: [...input.itemIds].sort(),
      status: input.status,
      ownerReference: input.ownerReference ?? null,
      expectedRevision: input.expectedRevision ?? null,
    });
    const previous = await transaction.workflowAuditEvent.findUnique({
      where: {
        organizationId_idempotencyKey: {
          organizationId: input.organizationId,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (previous) {
      assertIdempotentEvent(previous, {
        entityType: "SHORTLIST",
        entityId: input.shortlistId,
        eventType: "ITEMS_TRANSITIONED",
        fingerprint,
      });
      return { count: Number(auditPayload(previous.payload).count ?? 0) };
    }
    const items = await transaction.shortlistItem.findMany({
      where: {
        id: { in: input.itemIds },
        shortlistId: input.shortlistId,
        organizationId: input.organizationId,
      },
      include: {
        profitResult: {
          include: {
            supplierRow: {
              include: {
                matchDecision: {
                  include: {
                    selectedCandidate: { include: { packGuard: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (items.length !== new Set(input.itemIds).size)
      throw new Error("SHORTLIST_ITEM_NOT_FOUND");
    if (
      input.expectedRevision !== undefined &&
      items.some((item) => item.revision !== input.expectedRevision)
    )
      throw new Error("SHORTLIST_REVISION_CONFLICT");
    if (
      input.status === "READY_FOR_PO" &&
      items.some((item) => {
        const match = item.profitResult.supplierRow.matchDecision;
        return (
          item.profitResult.status !== "COMPLETED" ||
          item.profitResult.recommendation !== "BUY" ||
          !match ||
          !isProfitVerifiedMatch(match) ||
          match.selectedCandidate?.packGuard?.status !== "VERIFIED"
        );
      })
    )
      throw new Error("SHORTLIST_ITEM_NOT_PURCHASE_READY");
    const before = items.map((item) => ({
      id: item.id,
      status: item.status,
      ownerReference: item.ownerReference,
      revision: item.revision,
    }));
    await transaction.shortlistItem.updateMany({
      where: {
        id: { in: input.itemIds },
        organizationId: input.organizationId,
      },
      data: {
        status: input.status as never,
        ...(input.ownerReference !== undefined
          ? { ownerReference: input.ownerReference }
          : {}),
        revision: { increment: 1 },
      },
    });
    await transaction.shortlist.updateMany({
      where: { id: input.shortlistId, organizationId: input.organizationId },
      data: { revision: { increment: 1 } },
    });
    await transaction.workflowAuditEvent.create({
      data: {
        organizationId: input.organizationId,
        entityType: "SHORTLIST",
        entityId: input.shortlistId,
        eventType: "ITEMS_TRANSITIONED",
        idempotencyKey: input.idempotencyKey,
        payload: {
          fingerprint,
          count: items.length,
          before,
          after: {
            status: input.status,
            ownerReference: input.ownerReference ?? null,
          },
        },
      },
    });
    return { count: items.length };
  });
}

export async function addShortlistNote(input: {
  organizationId: string;
  shortlistId: string;
  itemId: string;
  body: string;
  authorReference?: string;
  idempotencyKey: string;
}) {
  return db.$transaction(async (transaction) => {
    const item = await transaction.shortlistItem.findFirst({
      where: {
        id: input.itemId,
        shortlistId: input.shortlistId,
        organizationId: input.organizationId,
      },
    });
    if (!item) return null;
    const fingerprint = requestFingerprint({
      shortlistId: input.shortlistId,
      itemId: input.itemId,
      body: input.body,
      authorReference: input.authorReference ?? null,
    });
    const event = await transaction.workflowAuditEvent.findFirst({
      where: {
        organizationId: input.organizationId,
        idempotencyKey: input.idempotencyKey,
      },
      select: {
        entityId: true,
        entityType: true,
        eventType: true,
        payload: true,
      },
    });
    if (event) {
      assertIdempotentEvent(event, {
        entityType: "SHORTLIST_ITEM",
        entityId: item.id,
        eventType: "NOTE_ADDED",
        fingerprint,
      });
      const noteId = auditPayload(event.payload).noteId;
      if (typeof noteId !== "string")
        throw new Error("IDEMPOTENCY_EVENT_INVALID");
      return transaction.shortlistNote.findFirst({
        where: { id: noteId, organizationId: input.organizationId },
      });
    }
    const note = await transaction.shortlistNote.create({
      data: {
        organizationId: input.organizationId,
        shortlistItemId: item.id,
        body: input.body,
        ...(input.authorReference !== undefined
          ? { authorReference: input.authorReference }
          : {}),
      },
    });
    await transaction.workflowAuditEvent.create({
      data: {
        organizationId: input.organizationId,
        entityType: "SHORTLIST_ITEM",
        entityId: item.id,
        eventType: "NOTE_ADDED",
        idempotencyKey: input.idempotencyKey,
        payload: { fingerprint, noteId: note.id },
      },
    });
    return note;
  });
}

export async function getShortlistItemsForPurchaseOrder(
  organizationId: string,
  shortlistId: string,
  itemIds: string[],
) {
  return db.shortlistItem.findMany({
    where: {
      organizationId,
      shortlistId,
      id: { in: itemIds },
      profitResult: { isCurrent: true },
    },
    include: {
      profitResult: {
        include: {
          shippingRoute: true,
          supplierRow: {
            include: {
              scanJob: true,
              normalizedOffer: true,
              matchDecision: {
                include: {
                  selectedCandidate: {
                    include: { packGuard: true, catalogProduct: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
}

export async function createPurchaseOrder(input: {
  organizationId: string;
  supplierId: string;
  shortlistId: string;
  shippingRouteId: string;
  scenarioType: "CURRENT" | "CONSERVATIVE" | "STRESS" | "MAP";
  currency: string;
  idempotencyKey: string;
  budgetAmount?: string;
  minimumOrderAmount?: string;
  lines: Array<Record<string, unknown>>;
  totals: Record<string, string>;
}) {
  return db.$transaction(async (transaction) => {
    const fingerprint = requestFingerprint({
      supplierId: input.supplierId,
      shortlistId: input.shortlistId,
      shippingRouteId: input.shippingRouteId,
      scenarioType: input.scenarioType,
      currency: input.currency,
      budgetAmount: input.budgetAmount ?? null,
      minimumOrderAmount: input.minimumOrderAmount ?? null,
      lines: input.lines,
      totals: input.totals,
    });
    const existing = await transaction.purchaseOrder.findUnique({
      where: {
        organizationId_idempotencyKey: {
          organizationId: input.organizationId,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existing) {
      const event = await transaction.workflowAuditEvent.findUnique({
        where: {
          organizationId_idempotencyKey: {
            organizationId: input.organizationId,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (!event) throw new Error("IDEMPOTENCY_EVENT_INVALID");
      assertIdempotentEvent(event, {
        entityType: "PURCHASE_ORDER",
        entityId: existing.id,
        eventType: "CREATED",
        fingerprint,
      });
      return existing;
    }
    const order = await transaction.purchaseOrder.create({
      data: {
        organizationId: input.organizationId,
        supplierId: input.supplierId,
        shortlistId: input.shortlistId,
        shippingRouteId: input.shippingRouteId,
        scenarioType: input.scenarioType,
        currency: input.currency,
        idempotencyKey: input.idempotencyKey,
        budgetAmount: input.budgetAmount,
        minimumOrderAmount: input.minimumOrderAmount,
        ...input.totals,
        lines: {
          create: input.lines.map((line) => ({
            organizationId: input.organizationId,
            ...line,
          })),
        },
      } as never,
    });
    await transaction.workflowAuditEvent.create({
      data: {
        organizationId: input.organizationId,
        entityType: "PURCHASE_ORDER",
        entityId: order.id,
        eventType: "CREATED",
        idempotencyKey: input.idempotencyKey,
        payload: {
          fingerprint,
          lineCount: input.lines.length,
          totals: input.totals,
        },
      },
    });
    return order;
  });
}

export async function getPurchaseOrderForOrganization(
  organizationId: string,
  purchaseOrderId: string,
) {
  return db.purchaseOrder.findFirst({
    where: { id: purchaseOrderId, organizationId },
    include: {
      supplier: true,
      shippingRoute: true,
      lines: {
        include: {
          supplierRow: {
            include: {
              normalizedOffer: true,
              matchDecision: {
                include: {
                  selectedCandidate: { include: { catalogProduct: true } },
                },
              },
            },
          },
          profitResult: true,
          shortlistItem: true,
        },
        orderBy: { createdAt: "asc" },
      },
      exportJobs: { orderBy: { createdAt: "desc" } },
    },
  });
}

export async function listPurchaseOrdersForOrganization(
  organizationId: string,
) {
  return db.purchaseOrder.findMany({
    where: { organizationId },
    select: {
      id: true,
      status: true,
      currency: true,
      supplierSubtotal: true,
      projectedProfitTotal: true,
      createdAt: true,
      updatedAt: true,
      supplier: { select: { name: true, code: true } },
      shippingRoute: { select: { name: true } },
      _count: { select: { lines: true, exportJobs: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function validatePurchaseOrder(
  organizationId: string,
  purchaseOrderId: string,
  expectedRevision: number,
  idempotencyKey: string,
) {
  return db.$transaction(async (transaction) => {
    const fingerprint = requestFingerprint({
      purchaseOrderId,
      expectedRevision,
    });
    const previous = await transaction.workflowAuditEvent.findUnique({
      where: {
        organizationId_idempotencyKey: { organizationId, idempotencyKey },
      },
    });
    if (previous) {
      assertIdempotentEvent(previous, {
        entityType: "PURCHASE_ORDER",
        entityId: purchaseOrderId,
        eventType: "VALIDATED",
        fingerprint,
      });
      return transaction.purchaseOrder.findFirst({
        where: { id: purchaseOrderId, organizationId },
      });
    }
    const order = await transaction.purchaseOrder.findFirst({
      where: { id: purchaseOrderId, organizationId },
      include: {
        supplier: true,
        shippingRoute: true,
        lines: {
          include: {
            profitResult: {
              include: {
                supplierRow: {
                  include: {
                    scanJob: true,
                    matchDecision: {
                      include: {
                        selectedCandidate: { include: { packGuard: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!order) return null;
    if (order.revision !== expectedRevision)
      throw new Error("PURCHASE_ORDER_REVISION_CONFLICT");
    if (!order.lines.length) throw new Error("PURCHASE_ORDER_LINES_REQUIRED");
    if (
      !order.supplier.orderingRulesSource ||
      !order.supplier.orderingRulesObservedAt ||
      order.lines.some(
        (line) =>
          line.minimumOrderCases !== order.supplier.minimumOrderCases ||
          line.orderMultipleCases !== order.supplier.orderMultipleCases,
      )
    )
      throw new Error("SUPPLIER_ORDERING_RULES_CHANGED");
    if (
      order.minimumOrderAmount !== null &&
      order.supplierSubtotal.lessThan(order.minimumOrderAmount)
    )
      throw new Error("PURCHASE_ORDER_MINIMUM_NOT_MET");
    if (
      order.budgetAmount !== null &&
      order.supplierSubtotal.greaterThan(order.budgetAmount)
    )
      throw new Error("PURCHASE_ORDER_BUDGET_EXCEEDED");
    if (
      order.lines.some((line) => {
        const match = line.profitResult.supplierRow.matchDecision;
        return (
          !line.profitResult.isCurrent ||
          line.profitResult.shippingRouteId !== order.shippingRouteId ||
          line.profitResult.supplierRow.scanJob.supplierId !==
            order.supplierId ||
          line.profitResult.status !== "COMPLETED" ||
          line.profitResult.recommendation !== "BUY" ||
          !match ||
          !isProfitVerifiedMatch(match) ||
          match.selectedCandidate?.packGuard?.status !== "VERIFIED"
        );
      })
    )
      throw new Error("PURCHASE_ORDER_SOURCE_NOT_CURRENT");
    for (const line of order.lines)
      assertPersistedOrderLine(
        {
          requestedUnits: line.requestedUnits,
          casePack: line.casePack,
          minimumOrderCases: line.minimumOrderCases,
          orderMultipleCases: line.orderMultipleCases,
          orderedCases: line.orderedCases,
          orderedSellableUnits: line.orderedSellableUnits,
          supplierUnitCost: line.supplierUnitCost.toString(),
          scenarioPrice: line.scenarioPrice.toString(),
          scenarioEffectiveCogs: line.scenarioEffectiveCogs.toString(),
          scenarioAmazonFee: line.scenarioAmazonFee.toString(),
          scenarioNetProfit: line.scenarioNetProfit.toString(),
          supplierTotal: line.supplierTotal.toString(),
          landedCostTotal: line.landedCostTotal.toString(),
          projectedRevenueTotal: line.projectedRevenueTotal.toString(),
          amazonFeeTotal: line.amazonFeeTotal.toString(),
          projectedProfitTotal: line.projectedProfitTotal.toString(),
        } satisfies PersistedOrderLine,
        order.currency,
      );
    const totals = sumOrderLines(
      order.lines.map((line) => ({
        supplierTotal: line.supplierTotal.toString(),
        landedCostTotal: line.landedCostTotal.toString(),
        projectedRevenueTotal: line.projectedRevenueTotal.toString(),
        amazonFeeTotal: line.amazonFeeTotal.toString(),
        projectedProfitTotal: line.projectedProfitTotal.toString(),
      })),
    );
    if (
      totals.supplierSubtotal !== order.supplierSubtotal.toFixed(4) ||
      totals.landedCostTotal !== order.landedCostTotal.toFixed(4) ||
      totals.projectedRevenueTotal !== order.projectedRevenueTotal.toFixed(4) ||
      totals.amazonFeeTotal !== order.amazonFeeTotal.toFixed(4) ||
      totals.projectedProfitTotal !== order.projectedProfitTotal.toFixed(4)
    )
      throw new Error("PURCHASE_ORDER_TOTAL_RECONCILIATION_FAILED");
    const staleEvidence = order.lines.some((line) => {
      const snapshot = line.sourceSnapshot as {
        scenarioType?: string;
        currency?: string;
        orderingRules?: {
          source?: string;
          observedAt?: string;
          minimumOrderCases?: number;
          orderMultipleCases?: number;
        };
        evidence?: {
          scenarios?: Record<
            string,
            {
              evidence?: {
                price?: {
                  currency?: string;
                  freshnessState?: string;
                  freshUntil?: string;
                };
                feeQuote?: {
                  currency?: string;
                  freshnessState?: string;
                  freshUntil?: string;
                };
              };
            }
          >;
        };
      };
      const price =
        snapshot.evidence?.scenarios?.[snapshot.scenarioType ?? ""]?.evidence
          ?.price;
      const fee =
        snapshot.evidence?.scenarios?.[snapshot.scenarioType ?? ""]?.evidence
          ?.feeQuote;
      return (
        snapshot.scenarioType !== order.scenarioType ||
        snapshot.currency !== order.currency ||
        snapshot.orderingRules?.source !== order.supplier.orderingRulesSource ||
        snapshot.orderingRules?.observedAt !==
          order.supplier.orderingRulesObservedAt?.toISOString() ||
        snapshot.orderingRules?.minimumOrderCases !==
          order.supplier.minimumOrderCases ||
        snapshot.orderingRules?.orderMultipleCases !==
          order.supplier.orderMultipleCases ||
        !price ||
        !fee ||
        price.currency !== order.currency ||
        fee.currency !== order.currency ||
        price.freshnessState !== "FRESH" ||
        fee.freshnessState !== "FRESH" ||
        !price.freshUntil ||
        !fee.freshUntil ||
        new Date(price.freshUntil).getTime() < Date.now() ||
        new Date(fee.freshUntil).getTime() < Date.now()
      );
    });
    if (staleEvidence) throw new Error("PURCHASE_ORDER_EVIDENCE_STALE");
    await transaction.purchaseOrder.update({
      where: { id: order.id },
      data: {
        status: "VALIDATED",
        validatedAt: new Date(),
        revision: { increment: 1 },
      },
    });
    await transaction.workflowAuditEvent.create({
      data: {
        organizationId,
        entityType: "PURCHASE_ORDER",
        entityId: order.id,
        eventType: "VALIDATED",
        idempotencyKey,
        revision: order.revision + 1,
        payload: { fingerprint, totals, currency: order.currency },
      },
    });
    return { ...order, status: "VALIDATED", revision: order.revision + 1 };
  });
}

export async function queueExport(input: {
  organizationId: string;
  kind: "SHORTLIST" | "PURCHASE_ORDER" | "AUDIT_REPORT";
  format: "CSV" | "XLSX";
  shortlistId?: string;
  purchaseOrderId?: string;
  sourceRevision: number;
  idempotencyKey: string;
}) {
  return db.$transaction(async (transaction) => {
    const sourceId = input.purchaseOrderId ?? input.shortlistId;
    if (!sourceId) throw new Error("EXPORT_SOURCE_REQUIRED");
    const fingerprint = requestFingerprint({
      kind: input.kind,
      format: input.format,
      sourceId,
      sourceRevision: input.sourceRevision,
    });
    const existing = await transaction.exportJob.findUnique({
      where: {
        organizationId_idempotencyKey: {
          organizationId: input.organizationId,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existing) {
      const event = await transaction.workflowAuditEvent.findUnique({
        where: {
          organizationId_idempotencyKey: {
            organizationId: input.organizationId,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (!event) throw new Error("IDEMPOTENCY_EVENT_INVALID");
      assertIdempotentEvent(event, {
        entityType: "EXPORT",
        entityId: existing.id,
        eventType: "REQUESTED",
        fingerprint,
      });
      return existing;
    }
    const job = await transaction.exportJob.create({ data: { ...input } });
    await transaction.outboxEvent.create({
      data: {
        organizationId: input.organizationId,
        exportJobId: job.id,
        eventType: `export.requested.${job.id}`,
        payload: { kind: "EXPORT", exportJobId: job.id },
      },
    });
    await transaction.workflowAuditEvent.create({
      data: {
        organizationId: input.organizationId,
        entityType: "EXPORT",
        entityId: job.id,
        eventType: "REQUESTED",
        idempotencyKey: input.idempotencyKey,
        payload: {
          fingerprint,
          kind: input.kind,
          format: input.format,
          sourceId,
          sourceRevision: input.sourceRevision,
        },
      },
    });
    return job;
  });
}

export async function getExportForOrganization(
  organizationId: string,
  exportJobId: string,
) {
  return db.exportJob.findFirst({ where: { id: exportJobId, organizationId } });
}

/** Returns only expired private artifacts. Callers must delete storage first, then acknowledge. */
export async function listExpiredExportObjects(now: Date, limit = 100) {
  return db.exportJob.findMany({
    where: {
      status: "COMPLETED",
      expiresAt: { lte: now },
      objectKey: { not: null },
    },
    select: { id: true, organizationId: true, objectKey: true },
    orderBy: { expiresAt: "asc" },
    take: limit,
  });
}

/** Persist report-mode retention candidates so an operator can review them. */
export async function recordExpiredExportRetentionReport(
  items: Array<{ id: string; organizationId: string }>,
  now: Date,
) {
  const day = now.toISOString().slice(0, 10);
  for (const item of items) {
    await db.workflowAuditEvent.upsert({
      where: {
        organizationId_idempotencyKey: {
          organizationId: item.organizationId,
          idempotencyKey: `retention-report:${item.id}:${day}`,
        },
      },
      create: {
        organizationId: item.organizationId,
        entityType: "ExportJob",
        entityId: item.id,
        eventType: "export.retention_reported",
        idempotencyKey: `retention-report:${item.id}:${day}`,
        payload: {
          retention: "expired_export_object",
          reportedAt: now.toISOString(),
        },
      },
      update: {},
    });
  }
}

export async function acknowledgeExpiredExportObject(
  id: string,
  organizationId: string,
) {
  return db.$transaction(async (transaction) => {
    const updated = await transaction.exportJob.updateMany({
      where: {
        id,
        organizationId,
        status: "COMPLETED",
        objectKey: { not: null },
        expiresAt: { lte: new Date() },
      },
      data: { objectKey: null },
    });
    if (updated.count)
      await transaction.workflowAuditEvent.create({
        data: {
          organizationId,
          entityType: "ExportJob",
          entityId: id,
          eventType: "export.retention_deleted",
          payload: { retention: "expired_export_object" },
        },
      });
    return updated.count === 1;
  });
}

export async function listWorkflowAuditEvents(input: {
  organizationId: string;
  entityType: string;
  entityId: string;
}) {
  return db.workflowAuditEvent.findMany({
    where: input,
    orderBy: { createdAt: "asc" },
  });
}
