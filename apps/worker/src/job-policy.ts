import type { ScanJobStatus } from "@rizpoint/database";

export type UploadJobKind =
  | "UPLOAD_INSPECT"
  | "NORMALIZE"
  | "MATCH"
  | "ENRICH"
  | "CALCULATE"
  | "HISTORY_REFRESH"
  | "MOCK";

export type QueueJobKind = Exclude<UploadJobKind, "MOCK"> | "EXPORT" | "MOCK";

export const QUEUE_JOB_PRIORITIES = {
  INTERACTIVE: 1,
  CALCULATION: 3,
  EXPORT: 6,
  SCHEDULED_REFRESH: 10,
} as const;

/** BullMQ processes lower numeric priorities first. Scheduled/provider-heavy
 * refreshes cannot starve an upload or an explicit user calculation. */
export function queuePriorityForKind(kind: QueueJobKind): number {
  if (["UPLOAD_INSPECT", "NORMALIZE", "MATCH", "ENRICH", "MOCK"].includes(kind))
    return QUEUE_JOB_PRIORITIES.INTERACTIVE;
  if (kind === "CALCULATE") return QUEUE_JOB_PRIORITIES.CALCULATION;
  if (kind === "EXPORT") return QUEUE_JOB_PRIORITIES.EXPORT;
  return QUEUE_JOB_PRIORITIES.SCHEDULED_REFRESH;
}

export function mockScanQueueJobId(
  scanJobId: string,
  kind: UploadJobKind = "MOCK",
  attempt?: number,
  runId?: string,
): string {
  return `scan-${scanJobId}-${kind.toLowerCase()}${runId ? `-${runId}` : ""}${attempt ? `-${attempt}` : ""}`;
}

export function failureStatusForAttempt(
  attemptsMade: number,
  configuredAttempts: number | undefined,
): Extract<ScanJobStatus, "FAILED_RETRYABLE" | "FAILED_FINAL"> {
  const maxAttempts = configuredAttempts ?? 1;
  return attemptsMade + 1 >= maxAttempts ? "FAILED_FINAL" : "FAILED_RETRYABLE";
}

export function isProfitCalculationAttemptRunnable(
  status: "PENDING" | "RUNNING" | "FAILED_RETRYABLE" | "COMPLETED",
): boolean {
  return status === "PENDING" || status === "FAILED_RETRYABLE";
}
