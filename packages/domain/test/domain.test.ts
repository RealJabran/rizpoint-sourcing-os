import { describe, expect, it } from "vitest";
import { canTransitionJob, money } from "../src/index.js";

describe("job state transitions", () => {
  it("does not reopen a completed job", () => {
    expect(canTransitionJob("COMPLETED", "RUNNING")).toBe(false);
  });
});

describe("money", () => {
  it("keeps decimal addition exact", () => {
    expect(money("0.10").plus(money("0.20")).toFixed(2)).toBe("0.30");
  });
});
