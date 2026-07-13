import { describe, expect, it } from "vitest";
import { isMatchingAttemptRunnable } from "../src/matching.js";

describe("matching retry state policy", () => {
  it("resumes retryable matching attempts but not terminal or completed scans", () => {
    expect(isMatchingAttemptRunnable("MATCHING")).toBe(true);
    expect(isMatchingAttemptRunnable("FAILED_RETRYABLE")).toBe(true);
    expect(isMatchingAttemptRunnable("COMPLETED")).toBe(false);
    expect(isMatchingAttemptRunnable("FAILED_FINAL")).toBe(false);
  });
});
