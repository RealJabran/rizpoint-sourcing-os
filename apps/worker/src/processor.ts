import { Worker } from "bullmq";
import {
  completeMockScanJob,
  db,
  failScanJob,
  markScanJobRunning,
  persistNormalizedRows,
  persistUploadInspection,
  rejectUpload,
} from "@rizpoint/database";
import { getObjectBytes } from "@rizpoint/object-storage";
import { redis } from "./queue.js";
import { failureStatusForAttempt } from "./job-policy.js";
import {
  inspectWorkbook,
  normalizeWorkbook,
  requestMockScan,
} from "./scanner-client.js";

export const mockScanWorker = new Worker<{
  scanJobId: string;
  kind?: "UPLOAD_INSPECT" | "NORMALIZE";
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
        const sheet = scan.upload.sheets.find(
          (candidate) => candidate.selectedHeaderRow !== null,
        );
        if (!sheet?.selectedHeaderRow) throw new Error("mapping_not_ready");
        const bytes = await getObjectBytes(scan.upload.objectKey);
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
      const shouldProcess = await markScanJobRunning(job.data.scanJobId);
      if (!shouldProcess) return;
      const result = await requestMockScan(job.data.scanJobId);
      await completeMockScanJob(job.data.scanJobId, result.checksum, result);
    } catch (error) {
      const status = failureStatusForAttempt(
        job.attemptsMade,
        job.opts.attempts,
      );
      if (job.data.kind === "UPLOAD_INSPECT")
        await rejectUpload(job.data.scanJobId, "UPLOAD_INSPECTION_FAILED");
      else
        await failScanJob(job.data.scanJobId, status, "scanner_request_failed");
      throw error;
    }
  },
  { connection: redis, concurrency: 4, limiter: { max: 10, duration: 1_000 } },
);
