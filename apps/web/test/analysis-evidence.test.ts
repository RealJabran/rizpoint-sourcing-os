import { describe, expect, it } from "vitest";
import {
  observationFreshness,
  requiredNextActions,
} from "../src/analysis/evidence.js";

describe("analysis evidence presentation", () => {
  it("uses the persisted freshness field rather than an absent UI alias", () => {
    expect(observationFreshness({ freshnessState: "STALE" })).toBe("STALE");
    expect(observationFreshness({ freshness_state: "EXPIRED" })).toBe(
      "EXPIRED",
    );
  });

  it("turns a manual hard-contradiction override into a visible next action", () => {
    expect(
      requiredNextActions(["HARD_CONTRADICTION_MANUAL_OVERRIDE"]),
    ).toContain("Resolve the known identity contradiction before purchasing.");
  });
});
