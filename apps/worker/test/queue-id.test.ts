import { describe, expect, it } from "vitest";
import {
  failureStatusForAttempt,
  mockScanQueueJobId,
} from "../src/job-policy.js";

describe("queue idempotency", () => {
  it("derives a BullMQ-safe deterministic queue job id", () => {
    expect(mockScanQueueJobId("scan_123")).toBe("scan-scan_123");
    expect(mockScanQueueJobId("scan_123")).not.toContain(":");
  });

  it("marks only the last configured attempt as final", () => {
    expect(failureStatusForAttempt(0, 3)).toBe("FAILED_RETRYABLE");
    expect(failureStatusForAttempt(2, 3)).toBe("FAILED_FINAL");
  });
});
