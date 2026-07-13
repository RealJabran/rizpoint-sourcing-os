import { describe, expect, it } from "vitest";
import {
  failureStatusForAttempt,
  isProfitCalculationAttemptRunnable,
  mockScanQueueJobId,
} from "../src/job-policy.js";

describe("queue idempotency", () => {
  it("derives a BullMQ-safe deterministic queue job id", () => {
    expect(mockScanQueueJobId("scan_123", "UPLOAD_INSPECT")).toBe(
      "scan-scan_123-upload_inspect",
    );
    expect(mockScanQueueJobId("scan_123", "NORMALIZE")).toBe(
      "scan-scan_123-normalize",
    );
    expect(mockScanQueueJobId("scan_123", "MATCH")).toBe("scan-scan_123-match");
    expect(mockScanQueueJobId("scan_123", "CALCULATE", 2)).toBe(
      "scan-scan_123-calculate-2",
    );
    expect(mockScanQueueJobId("scan_123", "CALCULATE", 1, "run_456")).toBe(
      "scan-scan_123-calculate-run_456-1",
    );
    expect(mockScanQueueJobId("scan_123", "UPLOAD_INSPECT")).not.toBe(
      mockScanQueueJobId("scan_123", "NORMALIZE"),
    );
    expect(mockScanQueueJobId("scan_123")).not.toContain(":");
  });

  it("marks only the last configured attempt as final", () => {
    expect(failureStatusForAttempt(0, 3)).toBe("FAILED_RETRYABLE");
    expect(failureStatusForAttempt(2, 3)).toBe("FAILED_FINAL");
  });

  it("only resumes pending or explicitly retryable calculations", () => {
    expect(isProfitCalculationAttemptRunnable("PENDING")).toBe(true);
    expect(isProfitCalculationAttemptRunnable("FAILED_RETRYABLE")).toBe(true);
    expect(isProfitCalculationAttemptRunnable("RUNNING")).toBe(false);
    expect(isProfitCalculationAttemptRunnable("COMPLETED")).toBe(false);
  });
});
