import { describe, expect, it } from "vitest";
import {
  failureStatusForAttempt,
  isProfitCalculationAttemptRunnable,
  mockScanQueueJobId,
  QUEUE_JOB_PRIORITIES,
  queuePriorityForKind,
} from "../src/job-policy.js";
import { isExportAttemptRunnable } from "../src/export.js";

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
    expect(mockScanQueueJobId("scan_123", "UPLOAD_INSPECT", 4)).not.toBe(
      mockScanQueueJobId("scan_123", "UPLOAD_INSPECT"),
    );
  });

  it("marks only the last configured attempt as final", () => {
    expect(failureStatusForAttempt(0, 3)).toBe("FAILED_RETRYABLE");
    expect(failureStatusForAttempt(2, 3)).toBe("FAILED_FINAL");
  });

  it("keeps scheduled refresh work below interactive and export priority", () => {
    expect(queuePriorityForKind("UPLOAD_INSPECT")).toBe(
      QUEUE_JOB_PRIORITIES.INTERACTIVE,
    );
    expect(queuePriorityForKind("CALCULATE")).toBe(
      QUEUE_JOB_PRIORITIES.CALCULATION,
    );
    expect(queuePriorityForKind("EXPORT")).toBe(QUEUE_JOB_PRIORITIES.EXPORT);
    expect(queuePriorityForKind("HISTORY_REFRESH")).toBe(
      QUEUE_JOB_PRIORITIES.SCHEDULED_REFRESH,
    );
    expect(queuePriorityForKind("UPLOAD_INSPECT")).toBeLessThan(
      queuePriorityForKind("HISTORY_REFRESH"),
    );
  });

  it("only resumes pending or explicitly retryable calculations", () => {
    expect(isProfitCalculationAttemptRunnable("PENDING")).toBe(true);
    expect(isProfitCalculationAttemptRunnable("FAILED_RETRYABLE")).toBe(true);
    expect(isProfitCalculationAttemptRunnable("RUNNING")).toBe(false);
    expect(isProfitCalculationAttemptRunnable("COMPLETED")).toBe(false);
  });
  it("recovers only expired export leases", () => {
    const now = new Date("2026-07-14T00:00:00.000Z");
    expect(isExportAttemptRunnable("PENDING", now, now)).toBe(true);
    expect(isExportAttemptRunnable("FAILED_RETRYABLE", now, now)).toBe(true);
    expect(
      isExportAttemptRunnable(
        "RUNNING",
        new Date(now.getTime() - 15 * 60_001),
        now,
      ),
    ).toBe(true);
    expect(
      isExportAttemptRunnable(
        "RUNNING",
        new Date(now.getTime() - 15 * 60_000),
        now,
      ),
    ).toBe(false);
    expect(isExportAttemptRunnable("COMPLETED", now, now)).toBe(false);
  });
});
