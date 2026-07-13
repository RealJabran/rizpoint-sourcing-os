import { Worker } from "bullmq";
import {
  completeMockScanJob,
  db,
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
]);

function errorCode(error: unknown): string {
  return error instanceof ScannerRequestError
    ? error.code
    : "SCANNER_REQUEST_FAILED";
}

export const mockScanWorker = new Worker<{
  scanJobId: string;
  kind?: "UPLOAD_INSPECT" | "NORMALIZE" | "MATCH";
}>(
  "mock-scan",
  async (job) => {
    try {
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
          job.data.scanJobId,
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
          job.data.scanJobId,
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
      const shouldProcess = await markScanJobRunning(job.data.scanJobId);
      if (!shouldProcess) return;
      const result = await requestMockScan(job.data.scanJobId);
      await completeMockScanJob(job.data.scanJobId, result.checksum, result);
    } catch (error) {
      const status = failureStatusForAttempt(
        job.attemptsMade,
        job.opts.attempts,
      );
      const code = errorCode(error);
      const terminal =
        terminalUploadErrorCodes.has(code) || status === "FAILED_FINAL";
      if (job.data.kind === "UPLOAD_INSPECT" || job.data.kind === "NORMALIZE") {
        await failUploadStage(
          job.data.scanJobId,
          job.data.kind,
          terminal ? "FAILED_FINAL" : status,
          code,
          terminal,
          code === "MALWARE_DETECTED" ? "INFECTED" : undefined,
        );
        if (terminal) return;
      } else {
        await failScanJob(
          job.data.scanJobId,
          status,
          job.data.kind === "MATCH"
            ? "matching_failed"
            : "scanner_request_failed",
        );
      }
      throw error;
    }
  },
  { connection: redis, concurrency: 4, limiter: { max: 10, duration: 1_000 } },
);
