import { describe, expect, it } from "vitest";
import { runResearchEvaluation } from "../src/index.js";

describe("research accuracy release gate", () => {
  it("passes every versioned metric, AI-grounding, and provider-contract case", async () => {
    const report = await runResearchEvaluation();
    expect(report.cases.filter((item) => !item.passed)).toEqual([]);
    expect(report).toMatchObject({
      benchmarkVersion: "research-accuracy-benchmark/v1",
      caseCount: 32,
      passedCount: 32,
      failedCount: 0,
      passed: true,
      salesQuality: {
        sampleSize: 3,
        mae: "10.00",
        mapePercent: "15.00",
        intervalCoveragePercent: "100.00",
        passed: true,
      },
    });
  });
});
