import type { ScanJobStatus } from "@rizpoint/database";

export function mockScanQueueJobId(scanJobId: string): string {
  return `scan-${scanJobId}`;
}

export function failureStatusForAttempt(
  attemptsMade: number,
  configuredAttempts: number | undefined,
): Extract<ScanJobStatus, "FAILED_RETRYABLE" | "FAILED_FINAL"> {
  const maxAttempts = configuredAttempts ?? 1;
  return attemptsMade + 1 >= maxAttempts ? "FAILED_FINAL" : "FAILED_RETRYABLE";
}
