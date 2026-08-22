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
import { syntheticFixtureDataRights } from "./repositories/provider-data-rights.js";

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
      engineVersion: "profit-engine/v3",
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
  const offers = rows.map((row, index) => ({
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
  }));
  const warningRows = rows.flatMap((row, index) =>
    row.warnings.map((warning) => ({
      id: randomUUID(),
      supplierRowId: createdRows[index]!.id,
      code: warning.code,
      severity: warning.severity,
      field: warning.field,
    })),
  );
  await db.$transaction(
    async (transaction) => {
      const scan = await transaction.scanJob.findUnique({
        where: { id: scanJobId },
        include: { upload: true },
      });
      if (!scan?.upload) return;
      await transaction.supplierRow.deleteMany({ where: { scanJobId } });
      await transaction.supplierRow.createMany({ data: createdRows });
      await transaction.normalizedOffer.createMany({ data: offers });
      if (warningRows.length > 0)
        await transaction.normalizationWarning.createMany({
          data: warningRows,
        });
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
    },
    // Normalization intentionally commits several bounded bulk inserts and the
    // checkpoint atomically. Prisma's 5s default is too short on a cold local or
    // production connection; preprocessing above keeps non-database work out of
    // the transaction while this explicit ceiling prevents an unbounded hold.
    { maxWait: 10_000, timeout: 30_000 },
  );
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
const MOCK_AMAZON_CAPABILITIES = [
  "CATALOG",
  "COMPETITIVE_OFFERS",
  "FEES",
  "RESTRICTIONS",
  "MARKET_HISTORY",
] as const;
const LIVE_AMAZON_CAPABILITIES = [
  "CATALOG",
  "COMPETITIVE_OFFERS",
  "FEES",
  "RESTRICTIONS",
] as const;

async function ensureAmazonCapabilityRows(
  transaction: Prisma.TransactionClient,
  connection: {
    id: string;
    organizationId: string;
    provider: "AMAZON_SP_API" | "MOCK_AMAZON" | "MOCK_HISTORY";
    marketplaceId: string;
    status: "PENDING" | "ACTIVE" | "AUTH_REQUIRED" | "REVOKED" | "ERROR";
    lastErrorCode: string | null;
    lastSuccessAt: Date | null;
    lastValidatedAt: Date | null;
  },
) {
  const mock = connection.provider === "MOCK_AMAZON";
  const connectionState = mock
    ? ("HEALTHY" as const)
    : connection.status === "ACTIVE"
      ? ("AUTHORIZED" as const)
      : connection.status === "AUTH_REQUIRED" || connection.status === "REVOKED"
        ? ("UNAUTHORIZED" as const)
        : connection.status === "PENDING"
          ? ("CONFIGURED" as const)
          : connection.lastErrorCode === "THROTTLED"
            ? ("THROTTLED" as const)
            : ("UNAVAILABLE" as const);
  const checkedAt =
    connection.lastValidatedAt ?? connection.lastSuccessAt ?? new Date();
  const mockRights = mock ? syntheticFixtureDataRights(checkedAt) : null;
  const capabilities = mock
    ? MOCK_AMAZON_CAPABILITIES
    : LIVE_AMAZON_CAPABILITIES;
  await Promise.all(
    capabilities.map(async (capability) => {
      const providerKey = mock ? "mock-amazon" : "amazon-sp-api";
      const existing = await transaction.providerEntitlement.findUnique({
        where: {
          organizationId_providerKey_marketplaceId_capability: {
            organizationId: connection.organizationId,
            providerKey,
            marketplaceId: connection.marketplaceId,
            capability,
          },
        },
      });
      if (
        existing &&
        ["QUOTA_EXHAUSTED", "THROTTLED"].includes(existing.state) &&
        existing.retryAt &&
        existing.retryAt > checkedAt
      )
        return existing;
      // Sellers validation proves the account connection only. Preserve every
      // capability-specific probe result; a 403, partial response, or outage
      // must not be rewritten as authorized by an unrelated runtime lookup.
      const capabilitySpecific =
        !mock &&
        connectionState === "AUTHORIZED" &&
        existing &&
        ![
          "CONNECTION_NOT_AUTHORIZED",
          "LOCAL_CONNECTION_REVOKED",
          "MARKETPLACE_NOT_PARTICIPATING",
        ].includes(existing.reasonCode ?? "");
      const state = capabilitySpecific ? existing.state : connectionState;
      const capabilityCheckedAt = capabilitySpecific
        ? existing.checkedAt
        : checkedAt;
      const reasonCode = capabilitySpecific
        ? existing.reasonCode
        : state === "UNAUTHORIZED"
          ? "CONNECTION_NOT_AUTHORIZED"
          : state === "THROTTLED"
            ? "PROVIDER_THROTTLED"
            : state === "UNAVAILABLE"
              ? "PROVIDER_OUTAGE"
              : null;
      return transaction.providerEntitlement.upsert({
        where: {
          organizationId_providerKey_marketplaceId_capability: {
            organizationId: connection.organizationId,
            providerKey,
            marketplaceId: connection.marketplaceId,
            capability,
          },
        },
        create: {
          organizationId: connection.organizationId,
          providerConnectionId: connection.id,
          providerKey,
          marketplaceId: connection.marketplaceId,
          capability,
          mode: mock ? "MOCK" : "LIVE",
          state,
          reasonCode,
          retryAt: capabilitySpecific ? existing.retryAt : null,
          completeness: capabilitySpecific
            ? existing.completeness
            : state === "HEALTHY"
              ? "COMPLETE"
              : "UNKNOWN",
          checkedAt: capabilityCheckedAt,
          ...(mockRights
            ? {
                dataUsageScope: mockRights.usageScope,
                exportPolicy: mockRights.exportPolicy,
                exportableFields: mockRights.exportableFields,
                dataRetentionDays: mockRights.retentionDays ?? 730,
                termsReference: mockRights.termsReference,
                termsVersion: mockRights.termsVersion,
                termsReviewedAt: mockRights.termsReviewedAt,
                rightsEffectiveAt: mockRights.effectiveAt,
              }
            : {}),
          ...(capabilitySpecific
            ? { lastSuccessAt: existing.lastSuccessAt }
            : state === "HEALTHY" || state === "AUTHORIZED"
              ? { lastSuccessAt: connection.lastSuccessAt ?? checkedAt }
              : {}),
        },
        update: {
          providerConnectionId: connection.id,
          mode: mock ? "MOCK" : "LIVE",
          state,
          reasonCode,
          retryAt: capabilitySpecific ? existing.retryAt : null,
          completeness: capabilitySpecific
            ? existing.completeness
            : state === "HEALTHY"
              ? "COMPLETE"
              : "UNKNOWN",
          checkedAt: capabilityCheckedAt,
          ...(mockRights
            ? {
                dataUsageScope: mockRights.usageScope,
                exportPolicy: mockRights.exportPolicy,
                exportableFields: mockRights.exportableFields,
                dataRetentionDays: mockRights.retentionDays ?? 730,
                termsReference: mockRights.termsReference,
                termsVersion: mockRights.termsVersion,
                termsReviewedAt: mockRights.termsReviewedAt,
                rightsEffectiveAt: mockRights.effectiveAt,
              }
            : {}),
          ...(capabilitySpecific
            ? { lastSuccessAt: existing.lastSuccessAt }
            : state === "HEALTHY" || state === "AUTHORIZED"
              ? { lastSuccessAt: connection.lastSuccessAt ?? checkedAt }
              : {}),
        },
      });
    }),
  );
}

/** Creates the fixture-only connection used by local development and tests. */
export async function ensureMockAmazonConnection(organizationId: string) {
  return db.$transaction(async (transaction) => {
    const connection = await transaction.providerConnection.upsert({
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
    await ensureAmazonCapabilityRows(transaction, connection);
    return connection;
  });
}

/** Credential-free projection for status UI. Tenant scope is mandatory. */
export async function getAmazonProviderConnectionStatus(
  organizationId: string,
) {
  const connection = await db.providerConnection.findFirst({
    where: { organizationId, provider: "AMAZON_SP_API" },
    orderBy: { updatedAt: "desc" },
  });
  if (!connection) return null;
  await db.$transaction((transaction) =>
    ensureAmazonCapabilityRows(transaction, connection),
  );
  return {
    status: connection.status,
    marketplaceId: connection.marketplaceId,
    lastValidatedAt: connection.lastValidatedAt,
    lastSuccessAt: connection.lastSuccessAt,
    lastErrorCode: connection.lastErrorCode,
  };
}

/** Worker-only connection lookup. The caller receives encrypted material but
 * must decrypt it locally; web routes only use the status projection above. */
export async function getCatalogProviderConnection(
  organizationId: string,
  marketplaceId?: string,
) {
  const connection = await db.providerConnection.findFirst({
    where: {
      organizationId,
      provider: "AMAZON_SP_API",
      status: "ACTIVE",
      ...(marketplaceId
        ? {
            OR: [
              { marketplaceId },
              {
                marketplaces: {
                  some: { marketplaceId, isParticipating: true },
                },
              },
            ],
          }
        : {}),
    },
    include: {
      marketplaces: {
        where: {
          isParticipating: true,
          ...(marketplaceId ? { marketplaceId } : {}),
        },
        orderBy: [{ isDefault: "desc" }, { observedAt: "desc" }],
        take: 1,
      },
    },
    orderBy: { authorizedAt: "desc" },
  });
  if (connection) {
    await db.$transaction((transaction) =>
      ensureAmazonCapabilityRows(transaction, connection),
    );
    return {
      ...connection,
      marketplaceId:
        connection.marketplaces[0]?.marketplaceId ??
        marketplaceId ??
        connection.marketplaceId,
    };
  }
  const failedLiveConnection = await db.providerConnection.findFirst({
    where: { organizationId, provider: "AMAZON_SP_API" },
    select: { id: true },
  });
  if (failedLiveConnection) return null;
  const localMockAllowed =
    process.env.PHASE_ZERO_DEMO_MODE === "true" &&
    (process.env.PROVIDER_MODE ?? "mock") === "mock";
  if (!localMockAllowed) return null;
  const mock = await ensureMockAmazonConnection(organizationId);
  return !marketplaceId || marketplaceId === mock.marketplaceId ? mock : null;
}

export async function queueEnrichment(
  organizationId: string,
  scanJobId: string,
  idempotencyKey?: string,
  options: { forceRefresh?: boolean } = {},
) {
  return db.$transaction(async (transaction) => {
    // A user-visible refresh can be retried by the browser. Preserve the first
    // persisted run instead of incrementing its attempt count or reissuing its
    // outbox event. Worker retries remain checkpointed on the run itself.
    if (idempotencyKey) {
      const priorEvent = await transaction.workflowAuditEvent.findUnique({
        where: {
          organizationId_idempotencyKey: { organizationId, idempotencyKey },
        },
      });
      if (priorEvent) {
        if (
          priorEvent.entityType !== "ENRICHMENT_RUN" ||
          priorEvent.eventType !== "REFRESH_REQUESTED"
        )
          throw new Error("IDEMPOTENCY_KEY_REUSED");
        const priorRun = await transaction.enrichmentRun.findFirst({
          where: { id: priorEvent.entityId, organizationId, scanJobId },
        });
        if (!priorRun) throw new Error("IDEMPOTENCY_EVENT_INVALID");
        return { ...priorRun, duplicate: true };
      }
    }
    const scan = await transaction.scanJob.findFirst({
      where: { id: scanJobId, organizationId, jobType: "UPLOAD" },
      include: { _count: { select: { supplierRows: true } } },
    });
    if (!scan || scan._count.supplierRows === 0) return null;
    if (!["COMPLETED", "PARTIAL_SUCCESS"].includes(scan.status)) return null;
    let connection = await transaction.providerConnection.findFirst({
      where: {
        organizationId,
        provider: "AMAZON_SP_API",
        status: "ACTIVE",
      },
      orderBy: { authorizedAt: "desc" },
    });
    const anyLiveConnection = connection
      ? true
      : Boolean(
          await transaction.providerConnection.findFirst({
            where: { organizationId, provider: "AMAZON_SP_API" },
            select: { id: true },
          }),
        );
    const localMockAllowed =
      !anyLiveConnection &&
      process.env.PHASE_ZERO_DEMO_MODE === "true" &&
      (process.env.PROVIDER_MODE ?? "mock") === "mock";
    if (!connection && localMockAllowed)
      connection = await transaction.providerConnection.upsert({
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
    await ensureAmazonCapabilityRows(transaction, connection);
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
        forceRefresh: options.forceRefresh ?? false,
      },
      update: {
        status: "PENDING",
        completedAt: null,
        attemptCount: { increment: 1 },
        forceRefresh: options.forceRefresh ?? false,
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
      where: {
        enrichmentRunId: run.id,
        ...(options.forceRefresh ? {} : { status: "PARTIAL_SUCCESS" }),
      },
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
    if (idempotencyKey)
      await transaction.workflowAuditEvent.create({
        data: {
          organizationId,
          entityType: "ENRICHMENT_RUN",
          entityId: run.id,
          eventType: "REFRESH_REQUESTED",
          idempotencyKey,
          payload: { scanJobId, attemptCount: run.attemptCount },
        },
      });
    return { ...run, duplicate: false };
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

export function providerCapabilityForOperation(operation: string) {
  return operation.includes("Competitive")
    ? ("COMPETITIVE_OFFERS" as const)
    : operation.includes("Fees")
      ? ("FEES" as const)
      : operation.includes("Restrictions")
        ? ("RESTRICTIONS" as const)
        : operation.toLowerCase().includes("history")
          ? ("MARKET_HISTORY" as const)
          : ("CATALOG" as const);
}

export function providerRuntimeStateForAttempt(
  status: "SUCCESS" | "RETRYABLE_ERROR" | "PERMANENT_ERROR" | "THROTTLED",
  errorCode?: string,
) {
  return status === "SUCCESS"
    ? ("HEALTHY" as const)
    : status === "THROTTLED"
      ? ("THROTTLED" as const)
      : errorCode === "UNAUTHORIZED" || errorCode === "FORBIDDEN"
        ? ("UNAUTHORIZED" as const)
        : ("UNAVAILABLE" as const);
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
  const capability = providerCapabilityForOperation(input.operation);
  const providerKey =
    input.provider === "AMAZON_SP_API" ? "amazon-sp-api" : "mock-amazon";
  const state = providerRuntimeStateForAttempt(input.status, input.errorCode);
  const now = new Date();
  return db.$transaction(async (transaction) => {
    const run = await transaction.enrichmentRun.findFirst({
      where: {
        id: input.enrichmentRunId,
        organizationId: input.organizationId,
      },
      include: { providerConnection: { select: { marketplaceId: true } } },
    });
    if (!run) throw new Error("ENRICHMENT_RUN_NOT_FOUND");
    const marketplaceId =
      run.providerConnection?.marketplaceId ?? DEFAULT_MARKETPLACE_ID;
    const entitlement = await transaction.providerEntitlement.findUnique({
      where: {
        organizationId_providerKey_marketplaceId_capability: {
          organizationId: input.organizationId,
          providerKey,
          marketplaceId,
          capability,
        },
      },
      select: { id: true },
    });
    const legacy = await transaction.providerCallAttempt.upsert({
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
    await transaction.providerRequestAttempt.upsert({
      where: {
        organizationId_providerKey_marketplaceId_capability_operation_requestHash_attempt:
          {
            organizationId: input.organizationId,
            providerKey,
            marketplaceId,
            capability,
            operation: input.operation,
            requestHash: input.requestKey,
            attempt: input.attempt,
          },
      },
      create: {
        organizationId: input.organizationId,
        ...(entitlement ? { entitlementId: entitlement.id } : {}),
        providerKey,
        marketplaceId,
        capability,
        operation: input.operation,
        requestHash: input.requestKey,
        mode: input.provider === "AMAZON_SP_API" ? "LIVE" : "MOCK",
        state,
        attempt: input.attempt,
        startedAt: now,
        ...(input.status === "SUCCESS" || input.status === "PERMANENT_ERROR"
          ? { completedAt: now }
          : {}),
        ...(input.httpStatus === undefined
          ? {}
          : { httpStatus: input.httpStatus }),
        ...(input.errorCode ? { errorCode: input.errorCode } : {}),
        ...(input.providerRequestId
          ? { providerRequestId: input.providerRequestId }
          : {}),
        ...(input.retryAt ? { retryAt: input.retryAt } : {}),
        budgetUnit: "REQUEST",
        estimatedUnits: "1.0000",
      },
      update: {
        state,
        ...(input.status === "SUCCESS" || input.status === "PERMANENT_ERROR"
          ? { completedAt: now }
          : {}),
        httpStatus: input.httpStatus ?? null,
        errorCode: input.errorCode ?? null,
        providerRequestId: input.providerRequestId ?? null,
        retryAt: input.retryAt ?? null,
      },
    });
    if (entitlement) {
      const reasonCode =
        state === "UNAUTHORIZED"
          ? "CONNECTION_NOT_AUTHORIZED"
          : state === "THROTTLED"
            ? "PROVIDER_THROTTLED"
            : state === "UNAVAILABLE"
              ? "PROVIDER_OUTAGE"
              : null;
      await transaction.providerEntitlement.update({
        where: { id: entitlement.id },
        data: {
          state,
          reasonCode,
          retryAt: input.retryAt ?? null,
          checkedAt: now,
          completeness: state === "HEALTHY" ? "COMPLETE" : "UNKNOWN",
          ...(state === "HEALTHY" ? { lastSuccessAt: now } : {}),
        },
      });
    }
    return legacy;
  });
}

export async function persistEnrichmentItem(input: {
  enrichmentItemId: string;
  observations: Array<{
    metricType: "CATALOG" | "PRICING" | "FEES" | "RESTRICTIONS" | "HISTORY";
    provider: "MOCK_AMAZON" | "AMAZON_SP_API" | "MOCK_HISTORY";
    observationKey?: string;
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
    operation?: string;
    observationStatus?:
      | "SUCCESS"
      | "PARTIAL"
      | "UNAUTHORIZED"
      | "THROTTLED"
      | "RETRYABLE_FAILURE"
      | "TERMINAL_FAILURE"
      | "UNAVAILABLE";
    requestHash?: string;
    requestInputs?: Prisma.InputJsonValue;
    completeness?: "COMPLETE" | "PARTIAL" | "UNKNOWN";
    rawEvidenceReference?: string;
    rawEvidence?: Prisma.InputJsonValue;
    asin?: string;
    featuredOfferState?: "PRESENT" | "ABSENT" | "UNKNOWN";
    featuredPrice?: string;
    featuredCurrency?: string;
    featuredFulfillment?: "AMAZON" | "MERCHANT" | "UNKNOWN";
    featuredSellerId?: string;
    amazonRetailPresence?: "PRESENT" | "ABSENT" | "UNKNOWN";
    visibleOfferCount?: number;
    visibleOfferCountCompleteness?: "COMPLETE" | "PARTIAL" | "UNKNOWN";
    fbaOfferCount?: number;
    fbaOfferCountCompleteness?: "COMPLETE" | "PARTIAL" | "UNKNOWN";
    fbmOfferCount?: number;
    fbmOfferCountCompleteness?: "COMPLETE" | "PARTIAL" | "UNKNOWN";
    lowestFbaPrice?: string;
    lowestFbmPrice?: string;
    feeScenarioSource?:
      "CURRENT_FEATURED_OFFER" | "CONSERVATIVE" | "USER_ENTERED";
    feeFulfillment?: "AMAZON" | "MERCHANT" | "UNKNOWN";
    feeComponents?: Array<{
      feeType: string;
      parentFeeType?: string;
      currency: string;
      feeAmount: string;
      promotionAmount?: string;
      taxAmount?: string;
      finalFee: string;
    }>;
    restrictionState?:
      | "ELIGIBLE"
      | "RESTRICTED"
      | "APPROVAL_REQUIRED"
      | "INCOMPLETE"
      | "UNAUTHORIZED"
      | "THROTTLED"
      | "UNKNOWN";
    restrictionReasonCodes?: string[];
    restrictionReasons?: Prisma.InputJsonValue;
    restrictionConditionType?: string;
  }>;
  missingMetrics: string[];
  errorCode?: string;
  preserveItemStatus?: boolean;
}) {
  await db.$transaction(async (transaction) => {
    for (const observation of input.observations) {
      const {
        feeComponents,
        observationKey: suppliedObservationKey,
        ...observationData
      } = observation;
      const observationKey =
        suppliedObservationKey ??
        (observation.metricType === "FEES"
          ? (observation.feeScenarioSource ?? "CURRENT_FEATURED_OFFER")
          : "PRIMARY");
      const current = await transaction.providerObservation.findUnique({
        where: {
          enrichmentItemId_metricType_provider_observationKey: {
            enrichmentItemId: input.enrichmentItemId,
            metricType: observation.metricType,
            provider: observation.provider,
            observationKey,
          },
        },
        select: { observedAt: true },
      });
      // A delayed retry must not regress current market evidence.
      if (
        current &&
        !shouldReplaceProviderObservation(
          current.observedAt,
          observation.observedAt,
        )
      )
        continue;
      const persisted = await transaction.providerObservation.upsert({
        where: {
          enrichmentItemId_metricType_provider_observationKey: {
            enrichmentItemId: input.enrichmentItemId,
            metricType: observation.metricType,
            provider: observation.provider,
            observationKey,
          },
        },
        create: {
          ...observationData,
          enrichmentItemId: input.enrichmentItemId,
          observationKey,
          freshnessState: observation.freshnessState,
        },
        update: { ...observationData, errorCode: null },
      });
      if (observation.metricType === "FEES") {
        await transaction.providerFeeComponent.deleteMany({
          where: { providerObservationId: persisted.id },
        });
        if (feeComponents?.length)
          await transaction.providerFeeComponent.createMany({
            data: feeComponents.map((component, ordinal) => ({
              providerObservationId: persisted.id,
              ordinal,
              feeType: component.feeType,
              currency: component.currency,
              feeAmount: component.feeAmount,
              finalFee: component.finalFee,
              ...(component.parentFeeType
                ? { parentFeeType: component.parentFeeType }
                : {}),
              ...(component.promotionAmount
                ? { promotionAmount: component.promotionAmount }
                : {}),
              ...(component.taxAmount
                ? { taxAmount: component.taxAmount }
                : {}),
            })),
          });
      }
    }
    if (!input.preserveItemStatus)
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

export function shouldReplaceProviderObservation(
  currentObservedAt: Date | null,
  incomingObservedAt: Date,
): boolean {
  return (
    currentObservedAt === null ||
    incomingObservedAt.getTime() >= currentObservedAt.getTime()
  );
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
        forceRefresh: false,
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
      enrichmentItems: {
        include: {
          enrichmentRun: { include: { providerConnection: true } },
          observations: { include: { feeComponents: true } },
        },
      },
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
    currentProceeds?: string;
    conservativeNetProfit?: string;
    stressNetProfit?: string;
    userEnteredNetProfit?: string;
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

export {
  getAnalysisResult,
  listAnalysisResults,
  listProfitResultsForScan,
} from "./repositories/analysis.js";
export type { AnalysisFilters, AnalysisSort } from "./repositories/analysis.js";
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
              userEnteredSalePrice: true,
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
  userEnteredSalePrice?: string | null | undefined;
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
            userEnteredSalePrice:
              input.userEnteredSalePrice === undefined
                ? (existing.userEnteredSalePrice?.toString() ?? null)
                : input.userEnteredSalePrice,
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
            userEnteredSalePrice: input.userEnteredSalePrice ?? null,
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
        previousValues: {
          costs: Object.fromEntries(
            existing?.values.map((value) => [
              value.field,
              value.value.toString(),
            ]) ?? [],
          ),
          stressDiscountPercent:
            existing?.stressDiscountPercent?.toString() ?? null,
          userEnteredSalePrice:
            existing?.userEnteredSalePrice?.toString() ?? null,
        },
        nextValues: {
          costs: Object.fromEntries(nextValues),
          stressDiscountPercent:
            input.stressDiscountPercent === undefined
              ? (existing?.stressDiscountPercent?.toString() ?? null)
              : input.stressDiscountPercent,
          userEnteredSalePrice:
            input.userEnteredSalePrice === undefined
              ? (existing?.userEnteredSalePrice?.toString() ?? null)
              : input.userEnteredSalePrice,
        },
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
        {
          providerConnectionJob: {
            is: { status: { notIn: ["COMPLETED", "FAILED_FINAL"] } },
          },
        },
        {
          productResearchRun: {
            is: {
              status: {
                notIn: ["COMPLETED", "PARTIAL_SUCCESS", "FAILED_FINAL"],
              },
            },
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
  kind: "SHORTLIST" | "PURCHASE_ORDER" | "AUDIT_REPORT" | "ANALYSIS_VIEW";
  format: "CSV" | "XLSX";
  shortlistId?: string;
  purchaseOrderId?: string;
  scanJobId?: string;
  queryState?: Prisma.InputJsonValue;
  sourceRevision?: number;
  idempotencyKey: string;
}) {
  return db.$transaction(async (transaction) => {
    const hasOnlySource =
      input.kind === "ANALYSIS_VIEW"
        ? Boolean(
            input.scanJobId && !input.shortlistId && !input.purchaseOrderId,
          )
        : input.kind === "SHORTLIST"
          ? Boolean(
              input.shortlistId && !input.scanJobId && !input.purchaseOrderId,
            )
          : Boolean(
              input.purchaseOrderId && !input.scanJobId && !input.shortlistId,
            );
    if (!hasOnlySource) throw new Error("EXPORT_SOURCE_INVALID");
    const sourceId =
      input.purchaseOrderId ?? input.shortlistId ?? input.scanJobId;
    if (!sourceId) throw new Error("EXPORT_SOURCE_REQUIRED");
    let sourceRevision = input.sourceRevision;
    if (input.kind === "ANALYSIS_VIEW") {
      if (!input.scanJobId || !input.queryState)
        throw new Error("ANALYSIS_EXPORT_SOURCE_REQUIRED");
      const scan = await transaction.scanJob.findFirst({
        where: { id: input.scanJobId, organizationId: input.organizationId },
        select: { attemptCount: true },
      });
      if (!scan) throw new Error("ANALYSIS_EXPORT_SCAN_NOT_FOUND");
      sourceRevision = scan.attemptCount;
    } else if (input.kind === "SHORTLIST") {
      const shortlist = await transaction.shortlist.findFirst({
        where: {
          id: input.shortlistId!,
          organizationId: input.organizationId,
        },
        select: { revision: true },
      });
      if (!shortlist) throw new Error("SHORTLIST_EXPORT_SOURCE_NOT_FOUND");
      if (sourceRevision !== shortlist.revision)
        throw new Error("EXPORT_SOURCE_STALE");
    } else {
      const order = await transaction.purchaseOrder.findFirst({
        where: {
          id: input.purchaseOrderId!,
          organizationId: input.organizationId,
        },
        select: { revision: true, status: true },
      });
      if (!order) throw new Error("PURCHASE_ORDER_EXPORT_SOURCE_NOT_FOUND");
      if (!["VALIDATED", "EXPORTED"].includes(order.status))
        throw new Error("PURCHASE_ORDER_NOT_VALIDATED");
      if (sourceRevision !== order.revision)
        throw new Error("EXPORT_SOURCE_STALE");
    }
    if (sourceRevision === undefined)
      throw new Error("EXPORT_SOURCE_REVISION_REQUIRED");
    const fingerprint = requestFingerprint({
      kind: input.kind,
      format: input.format,
      sourceId,
      sourceRevision,
      queryState: input.queryState ?? null,
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
    // Do not spread the request object here. With exact optional properties,
    // that leaves a required persisted revision typed as optional even after
    // the validation above. The explicit shape also prevents undefined JSON
    // or foreign-source fields from reaching Prisma.
    const job = await transaction.exportJob.create({
      data: {
        organizationId: input.organizationId,
        kind: input.kind,
        format: input.format,
        sourceRevision,
        idempotencyKey: input.idempotencyKey,
        ...(input.shortlistId ? { shortlistId: input.shortlistId } : {}),
        ...(input.purchaseOrderId
          ? { purchaseOrderId: input.purchaseOrderId }
          : {}),
        ...(input.scanJobId ? { scanJobId: input.scanJobId } : {}),
        ...(input.queryState ? { queryState: input.queryState } : {}),
      },
    });
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
          sourceRevision,
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
