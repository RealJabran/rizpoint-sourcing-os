import { describe, expect, it } from "vitest";
import {
  ANALYSIS_COST_FIELDS,
  ANALYSIS_SORT_FIELDS,
  canTransitionJob,
  money,
} from "../src/index.js";

describe("job state transitions", () => {
  it("does not reopen a completed job", () => {
    expect(canTransitionJob("COMPLETED", "RUNNING")).toBe(false);
  });
});

describe("analysis contracts", () => {
  it("has an explicit, finite set of editable money fields and sort keys", () => {
    expect(ANALYSIS_COST_FIELDS).toContain("SUPPLIER_COST_PER_SELLABLE_UNIT");
    expect(ANALYSIS_SORT_FIELDS).not.toContain("evidence");
  });
});

describe("money", () => {
  it("keeps decimal addition exact", () => {
    expect(money("0.10").plus(money("0.20")).toFixed(2)).toBe("0.30");
  });
});
