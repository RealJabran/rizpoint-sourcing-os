import { Queue } from "bullmq";
import { Redis } from "ioredis";
import type { UploadJobKind } from "./job-policy.js";

const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";

export const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
export const mockScanQueue = new Queue<
  {
    scanJobId?: string;
    exportJobId?: string;
    runId?: string;
    connectionJobId?: string;
    kind?: Exclude<UploadJobKind, "MOCK"> | "EXPORT" | "PROVIDER_CONNECTION";
  },
  void,
  "mock-scan"
>("mock-scan", {
  connection: redis,
});
