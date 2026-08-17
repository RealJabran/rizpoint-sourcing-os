import { describe, expect, it } from "vitest";
import { canAdvanceLaunchStage } from "../src/launch-planner-policy.js";

describe("launch stage gates", () => {
  it("requires dependencies before work starts or completes", () => {
    expect(
      canAdvanceLaunchStage({
        target: "SUPPLIER_SAMPLE",
        status: "IN_PROGRESS",
        stageStates: { NICHE_APPROVED: "NOT_STARTED" },
      }),
    ).toBe(false);
    expect(
      canAdvanceLaunchStage({
        target: "SUPPLIER_SAMPLE",
        status: "COMPLETE",
        stageStates: { NICHE_APPROVED: "COMPLETE" },
      }),
    ).toBe(true);
  });
});
