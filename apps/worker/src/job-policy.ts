import type { ScanJobStatus } from "@rizpoint/database";

export type UploadJobKind =
  "UPLOAD_INSPECT" | "NORMALIZE" | "MATCH" | "ENRICH" | "CALCULATE" | "MOCK";

export function mockScanQueueJobId(
  scanJobId: string,
  kind: UploadJobKind = "MOCK",
  attempt?: number,
): string {
  return `scan-${scanJobId}-${kind.toLowerCase()}${attempt ? `-${attempt}` : ""}`;
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
