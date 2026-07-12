import { Queue } from "bullmq";
import { Redis } from "ioredis";

const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";

export const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
export const mockScanQueue = new Queue<
  { scanJobId: string; kind?: "UPLOAD_INSPECT" | "NORMALIZE" },
  void,
  "mock-scan"
>("mock-scan", {
  connection: redis,
});
