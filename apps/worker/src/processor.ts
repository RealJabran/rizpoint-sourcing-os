import { Worker } from "bullmq";
import {
  completeMockScanJob,
  failScanJob,
  markScanJobRunning,
} from "@rizpoint/database";
import { redis } from "./queue.js";
import { failureStatusForAttempt } from "./job-policy.js";
import { requestMockScan } from "./scanner-client.js";

export const mockScanWorker = new Worker<{ scanJobId: string }>(
  "mock-scan",
  async (job) => {
    const shouldProcess = await markScanJobRunning(job.data.scanJobId);
    if (!shouldProcess) return;
    try {
      const result = await requestMockScan(job.data.scanJobId);
      await completeMockScanJob(job.data.scanJobId, result.checksum, result);
    } catch (error) {
      const status = failureStatusForAttempt(
        job.attemptsMade,
        job.opts.attempts,
      );
      await failScanJob(job.data.scanJobId, status, "scanner_request_failed");
      throw error;
    }
  },
  { connection: redis, concurrency: 4, limiter: { max: 10, duration: 1_000 } },
);
