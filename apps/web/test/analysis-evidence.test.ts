import { describe, expect, it } from "vitest";
import {
  observationFreshness,
  requiredNextActions,
} from "../src/analysis/evidence.js";
import { readFile } from "node:fs/promises";

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

  it("keeps raw provider history distinct from derived, window-labelled analytics", async () => {
    const source = await readFile(
      new URL("../src/analysis/history-panel.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain(
      "Raw provider observations and derived metrics are shown separately",
    );
    expect(source).toContain("Historical metrics are descriptive evidence");
    expect(source).toContain("No raw observations are retained");
    expect(source).not.toContain("rawPayload");
  });
});
