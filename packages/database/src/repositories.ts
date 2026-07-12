import type { Prisma, ScanJobStatus } from "./generated/prisma/client.js";
import { randomUUID } from "node:crypto";
import { db } from "./client.js";

export const PHASE_ZERO_ORGANIZATION_SLUG = "rizpoint-demo";

export async function ensurePhaseZeroOrganization() {
  const organization = await db.organization.upsert({
    where: { slug: PHASE_ZERO_ORGANIZATION_SLUG },
    create: {
      slug: PHASE_ZERO_ORGANIZATION_SLUG,
      name: "RizPoint Demo Organization",
    },
    update: {},
  });
  await db.supplier.upsert({
    where: {
      organizationId_code: { organizationId: organization.id, code: "VSI" },
    },
    create: {
      organizationId: organization.id,
      code: "VSI",
      name: "VSI",
      isVsiPreset: true,
    },
    update: {},
  });
  return organization;
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
    if (upload.status === "INSPECTING") return upload.scan;
    if (upload.status !== "PENDING_UPLOAD") return null;
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
        },
      },
      update: {
        status: "PENDING",
        claimToken: null,
        claimedAt: null,
        lastError: null,
      },
    });
    return upload.scan;
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
    const scan = await transaction.scanJob.findFirst({
      where: { id: scanJobId, organizationId },
      include: { upload: true },
    });
    if (!scan?.upload) return null;
    const sheet = await transaction.uploadSheet.findFirst({
      where: { id: uploadSheetId, uploadId: scan.upload.id },
    });
    if (!sheet) return null;
    if (
      !["MAPPING_REQUIRED", "READY"].includes(scan.status) ||
      headerRow < 1 ||
      headerRow > sheet.rowCount ||
      mappings.some(
        (mapping) =>
          mapping.sourceIndex < 0 || mapping.sourceIndex >= sheet.columnCount,
      )
    ) {
      return null;
    }
    await transaction.columnMapping.deleteMany({ where: { scanJobId } });
    await transaction.columnMapping.createMany({
      data: mappings.map((mapping) => ({ scanJobId, ...mapping })),
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
    await transaction.scanJob.update({
      where: { id: scanJobId },
      data: { status: "READY" },
    });
    return scan;
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
      data: { status },
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
            rejectionCode: null,
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

export type ClaimedOutboxEvent = {
  id: string;
  payload: Prisma.JsonValue;
  claimToken: string;
};

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
