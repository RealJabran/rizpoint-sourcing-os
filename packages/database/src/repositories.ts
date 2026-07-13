import type {
  CostOverrideField,
  Prisma,
  ProductRecommendation,
  ScanJobStatus,
} from "./generated/prisma/client.js";
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
    identifiers: Array<{
      type: "ASIN" | "UPC" | "EAN" | "GTIN" | "MPN";
      value: string;
    }>;
    provenance: {
      provider: string;
      providerReference?: string | undefined;
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
          observedAt: new Date(candidate.product.provenance.observedAt),
          freshnessState: candidate.product.provenance.freshnessState,
          rawPayload: candidate.product as unknown as Prisma.InputJsonValue,
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
          observedAt: new Date(candidate.product.provenance.observedAt),
          freshnessState: candidate.product.provenance.freshnessState,
          rawPayload: candidate.product as unknown as Prisma.InputJsonValue,
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
}) {
  const decision = await db.matchDecision.findFirst({
    where: {
      supplierRowId: input.supplierRowId,
      organizationId: input.organizationId,
    },
  });
  if (!decision) return null;
  if (input.status === "USER_ACCEPTED" && !input.selectedCandidateId)
    return null;
  if (input.selectedCandidateId) {
    const candidate = await db.listingCandidate.findFirst({
      where: {
        id: input.selectedCandidateId,
        supplierRowId: input.supplierRowId,
        organizationId: input.organizationId,
      },
    });
    if (!candidate) return null;
  }
  return db.matchDecision.update({
    where: { id: decision.id },
    data: {
      selectedCandidateId: input.selectedCandidateId,
      status: input.status,
      source: "HUMAN",
      reviewedAt: new Date(),
    },
  });
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
      provider_operation_requestKey_attempt: {
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
  await db.$transaction(async (transaction) => {
    const run = await transaction.profitCalculationRun.findFirst({
      where: { id: input.runId, organizationId: input.organizationId },
      select: { id: true, scanJobId: true, scope: true },
    });
    if (!run) return;
    for (const result of input.results) {
      const currentOverride = await transaction.profitCostOverride.findUnique({
        where: {
          organizationId_supplierRowId_shippingRouteId: {
            organizationId: input.organizationId,
            supplierRowId: result.supplierRowId,
            shippingRouteId: result.shippingRouteId,
          },
        },
        select: { revision: true, calculationRunId: true },
      });
      if (
        !shouldPromoteProfitResult({
          appliedOverrideRevision: result.appliedOverrideRevision,
          currentOverride,
          runId: input.runId,
        })
      )
        continue;
      await transaction.profitResult.updateMany({
        where: {
          organizationId: input.organizationId,
          scanJobId: run.scanJobId,
          supplierRowId: result.supplierRowId,
          shippingRouteId: result.shippingRouteId,
          isCurrent: true,
        },
        data: { isCurrent: false },
      });
      await transaction.profitResult.upsert({
        where: {
          profitCalculationRunId_supplierRowId_shippingRouteId: {
            profitCalculationRunId: input.runId,
            supplierRowId: result.supplierRowId,
            shippingRouteId: result.shippingRouteId,
          },
        },
        create: {
          ...result,
          organizationId: input.organizationId,
          scanJobId: run.scanJobId,
          profitCalculationRunId: input.runId,
          isCurrent: true,
        },
        update: { ...result, isCurrent: true, scanJobId: run.scanJobId },
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
  });
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
  if (!shippingRouteId) return { total: 0, rows: [], routes: [] };
  const where = analysisWhere(
    input.organizationId,
    input.scanJobId,
    shippingRouteId,
    input.filters,
  );
  const [total, rows, routes] = await db.$transaction([
    db.profitResult.count({ where }),
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
                      select: { asin: true, title: true, brand: true },
                    },
                    packGuard: { select: { status: true, reasonCode: true } },
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
  return { total, rows, routes, shippingRouteId };
}

export async function getAnalysisResult(
  organizationId: string,
  resultId: string,
) {
  return db.profitResult.findFirst({
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
                  catalogProduct: true,
                  evidence: true,
                  packGuard: true,
                },
              },
            },
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
