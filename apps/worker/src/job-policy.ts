import type { ScanJobStatus } from "@rizpoint/database";

export type UploadJobKind = "UPLOAD_INSPECT" | "NORMALIZE" | "MATCH" | "MOCK";

export function mockScanQueueJobId(
  scanJobId: string,
  kind: UploadJobKind = "MOCK",
): string {
  return `scan-${scanJobId}-${kind.toLowerCase()}`;
}

export function failureStatusForAttempt(
  attemptsMade: number,
  configuredAttempts: number | undefined,
): Extract<ScanJobStatus, "FAILED_RETRYABLE" | "FAILED_FINAL"> {
  const maxAttempts = configuredAttempts ?? 1;
  return attemptsMade + 1 >= maxAttempts ? "FAILED_FINAL" : "FAILED_RETRYABLE";
}
