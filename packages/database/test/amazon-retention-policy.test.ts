import { describe, expect, it } from "vitest";
import {
  addUtcCalendarMonths,
  amazonDeletionDeadline,
  amazonRetentionDeadline,
} from "../src/amazon-retention-policy.js";

describe("Amazon Information retention policy", () => {
  it("uses 18 calendar months and clamps end-of-month correctly", () => {
    expect(
      addUtcCalendarMonths(new Date("2025-08-31T12:30:00.000Z"), 18),
    ).toEqual(new Date("2027-02-28T12:30:00.000Z"));
    expect(
      amazonRetentionDeadline({
        observedAt: new Date("2025-01-31T00:00:00.000Z"),
      }),
    ).toEqual(new Date("2026-07-31T00:00:00.000Z"));
  });

  it("allows a shorter contractual window but never a longer requested window", () => {
    const observedAt = new Date("2025-01-01T00:00:00.000Z");
    expect(
      amazonRetentionDeadline({
        observedAt,
        requestedRetainUntil: new Date("2030-01-01T00:00:00.000Z"),
        shorterContractualRetentionDays: 90,
      }),
    ).toEqual(new Date("2025-04-01T00:00:00.000Z"));
  });

  it("calculates the current Amazon deletion deadline as 30 calendar days", () => {
    expect(
      amazonDeletionDeadline(new Date("2026-01-31T08:00:00.000Z")),
    ).toEqual(new Date("2026-03-02T08:00:00.000Z"));
  });
});
