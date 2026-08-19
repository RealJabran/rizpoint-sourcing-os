import { expect, it } from "vitest";
import { alertDedupeKey, evaluateAlert } from "../src/alert-evaluator.js";
it("does not convert absent provider data to zero and produces stable dedupe keys", () => {
  expect(evaluateAlert("LESS_THAN", "10", null)).toEqual({
    triggered: false,
    reason: "MISSING_DATA",
  });
  expect(evaluateAlert("LESS_THAN", "10", "9").triggered).toBe(true);
  const at = new Date("2026-01-01T00:00:00Z");
  expect(alertDedupeKey("rule", at, "9")).toBe(alertDedupeKey("rule", at, "9"));
});
