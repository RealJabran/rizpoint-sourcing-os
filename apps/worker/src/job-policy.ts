import type { ScanJobStatus } from "@rizpoint/database";
import { ProviderError } from "@rizpoint/provider-contracts";

export type UploadJobKind =
  | "UPLOAD_INSPECT"
  | "NORMALIZE"
  | "MATCH"
  | "ENRICH"
  | "CALCULATE"
  | "HISTORY_REFRESH"
  | "MOCK";

export type QueueJobKind = Exclude<UploadJobKind, "MOCK"> | "EXPORT" | "MOCK";
export type WorkerQueueJobKind = QueueJobKind | "PROVIDER_CONNECTION";

export const QUEUE_JOB_PRIORITIES = {
  INTERACTIVE: 1,
  CALCULATION: 3,
  EXPORT: 6,
  SCHEDULED_REFRESH: 10,
} as const;

/** BullMQ processes lower numeric priorities first. Scheduled/provider-heavy
 * refreshes cannot starve an upload or an explicit user calculation. */
export function queuePriorityForKind(kind: WorkerQueueJobKind): number {
  if (kind === "PROVIDER_CONNECTION") return QUEUE_JOB_PRIORITIES.INTERACTIVE;
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

/** Honor a provider Retry-After deadline when BullMQ retries a connection
 * operation. The fallback is deliberately slow enough to avoid reconnect
 * storms when Amazon supplies no explicit deadline. */
export function providerConnectionRetryDelay(error?: Error): number {
  if (
    error instanceof ProviderError &&
    error.options.retryAfterMs !== undefined
  )
    return Math.max(1_000, Math.min(error.options.retryAfterMs, 15 * 60_000));
  return 30_000;
}

export function isProfitCalculationAttemptRunnable(
  status: "PENDING" | "RUNNING" | "FAILED_RETRYABLE" | "COMPLETED",
): boolean {
  return status === "PENDING" || status === "FAILED_RETRYABLE";
}
