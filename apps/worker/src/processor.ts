import { Worker } from "bullmq";
import {
  completeMockScanJob,
  db,
  failProfitCalculation,
  failUploadStage,
  failScanJob,
  markScanJobRunning,
  persistNormalizedRows,
  persistUploadInspection,
} from "@rizpoint/database";
import { getObjectBytes } from "@rizpoint/object-storage";
import { createHash } from "node:crypto";
import { redis } from "./queue.js";
import { failureStatusForAttempt } from "./job-policy.js";
import { selectMappedUploadSheet } from "./normalization-selection.js";
import {
  inspectWorkbook,
  normalizeWorkbook,
  requestMockScan,
  ScannerRequestError,
} from "./scanner-client.js";
import { processMatching } from "./matching.js";
import { processEnrichment } from "./enrichment.js";
import { processProfitCalculation } from "./profit.js";
import { processExport } from "./export.js";
import { jobFailures, logger, redactText } from "./observability.js";
import { reportOperationalError } from "./error-tracking.js";

const terminalUploadErrorCodes = new Set([
  "EMPTY_FILE",
  "FILE_SIZE_LIMIT",
  "FILE_SIGNATURE_MISMATCH",
  "UNSUPPORTED_FILE_TYPE",
  "CSV_ENCODING",
  "INVALID_XLS",
  "INVALID_XLSX",
  "ZIP_EXPANSION_LIMIT",
  "SHEET_LIMIT",
  "ROW_LIMIT",
  "COLUMN_LIMIT",
  "NO_DATA_ROWS",
  "MAPPING_NOT_READY",
  "UPLOAD_CHECKSUM_MISMATCH",
  "MALWARE_DETECTED",
  "MALWARE_SCAN_CONFIGURATION",
]);

function errorCode(error: unknown): string {
  return error instanceof ScannerRequestError
    ? error.code
    : "SCANNER_REQUEST_FAILED";
}

export const mockScanWorker = new Worker<{
  scanJobId?: string;
  exportJobId?: string;
  runId?: string;
  kind?:
    | "UPLOAD_INSPECT"
    | "NORMALIZE"
    | "MATCH"
    | "ENRICH"
    | "CALCULATE"
    | "EXPORT";
}>(
  "mock-scan",
  async (job) => {
    try {
      if (job.data.kind === "EXPORT") {
        if (!job.data.exportJobId) throw new Error("export_job_id_missing");
        await processExport(job.data.exportJobId);
        return;
      }
      if (!job.data.scanJobId) throw new Error("scan_job_id_missing");
      if (job.data.kind === "UPLOAD_INSPECT") {
        const scan = await db.scanJob.findUnique({
          where: { id: job.data.scanJobId },
          include: { upload: true },
        });
        if (!scan?.upload) throw new Error("upload_not_found");
        const bytes = await getObjectBytes(scan.upload.objectKey);
        const inspection = await inspectWorkbook(
          scan.upload.originalFilename,
          bytes,
        );
        await persistUploadInspection(
          job.data.scanJobId!,
          inspection.file_format,
          inspection,
          inspection.sheets.map((sheet) => ({
            sheetIndex: sheet.sheet_index,
            name: sheet.name,
            rowCount: sheet.row_count,
            columnCount: sheet.column_count,
            headerCandidates: sheet.header_candidates,
            columns: sheet.columns,
            preview: sheet.preview,
          })),
        );
        return;
      }
      if (job.data.kind === "NORMALIZE") {
        const scan = await db.scanJob.findUnique({
          where: { id: job.data.scanJobId },
          include: {
            upload: { include: { sheets: true } },
            columnMappings: true,
          },
        });
        if (!scan?.upload) throw new Error("upload_not_found");
        const sheet = selectMappedUploadSheet(scan.upload.sheets);
        if (!sheet) throw new ScannerRequestError("MAPPING_NOT_READY");
        const bytes = await getObjectBytes(scan.upload.objectKey);
        const checksumSha256 = createHash("sha256").update(bytes).digest("hex");
        if (scan.upload.checksumSha256 !== checksumSha256)
          throw new ScannerRequestError("UPLOAD_CHECKSUM_MISMATCH");
        const normalized = await normalizeWorkbook(
          scan.upload.originalFilename,
          bytes,
          sheet.sheetIndex,
          sheet.selectedHeaderRow,
          scan.columnMappings.map((mapping) => ({
            source_index: mapping.sourceIndex,
            target: mapping.target,
          })),
        );
        await persistNormalizedRows(
          job.data.scanJobId!,
          sheet.id,
          normalized.rows.map((row) => ({
            sourceRowNumber: row.source_row_number,
            rawData: row.raw_data,
            rowChecksum: row.row_checksum,
            offer: row.offer,
            warnings: row.warnings,
          })),
        );
        return;
      }
      if (job.data.kind === "MATCH") {
        await processMatching(job.data.scanJobId);
        return;
      }
      if (job.data.kind === "ENRICH") {
        await processEnrichment(job.data.scanJobId);
        return;
      }
      if (job.data.kind === "CALCULATE") {
        if (!job.data.runId) throw new Error("profit_calculation_run_missing");
        await processProfitCalculation(job.data.runId);
        return;
      }
      const shouldProcess = await markScanJobRunning(job.data.scanJobId);
      if (!shouldProcess) return;
      const result = await requestMockScan(job.data.scanJobId);
      await completeMockScanJob(job.data.scanJobId, result.checksum, result);
    } catch (error) {
      jobFailures.inc({ kind: job.data.kind ?? "MOCK" });
      logger.error({
        event: "job_failed",
        kind: job.data.kind ?? "MOCK",
        scanJobId: job.data.scanJobId,
        exportJobId: job.data.exportJobId,
        message: error instanceof Error ? redactText(error.message) : "unknown",
      });
      void reportOperationalError({
        event: "job_failed",
        error,
        ...(job.data.scanJobId ? { scanJobId: job.data.scanJobId } : {}),
        ...(job.data.exportJobId ? { exportJobId: job.data.exportJobId } : {}),
      }).catch(() => undefined);
      if (job.data.kind === "EXPORT") throw error;
      const status = failureStatusForAttempt(
        job.attemptsMade,
        job.opts.attempts,
      );
      const code = errorCode(error);
      // A final queue attempt is recoverable by an explicit operator retry
      // unless scanner validation classified the file itself as unsafe.
      const terminal = terminalUploadErrorCodes.has(code);
      if (job.data.kind === "UPLOAD_INSPECT" || job.data.kind === "NORMALIZE") {
        await failUploadStage(
          job.data.scanJobId!,
          job.data.kind,
          terminal ? "FAILED_FINAL" : status,
          code,
          terminal,
          code === "MALWARE_DETECTED"
            ? "INFECTED"
            : code === "MALWARE_SCANNER_UNAVAILABLE" ||
                code === "MALWARE_SCAN_CONFIGURATION"
              ? "ERROR"
              : undefined,
        );
        if (terminal) return;
      } else {
        if (job.data.kind === "CALCULATE") {
          if (job.data.runId)
            await failProfitCalculation(job.data.runId, status);
        }
        if (job.data.kind !== "CALCULATE")
          await failScanJob(
            job.data.scanJobId!,
            status,
            job.data.kind === "MATCH"
              ? "matching_failed"
              : job.data.kind === "ENRICH"
                ? "enrichment_failed"
                : "scanner_request_failed",
          );
      }
      throw error;
    }
  },
  { connection: redis, concurrency: 4, limiter: { max: 10, duration: 1_000 } },
);
