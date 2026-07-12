import { describe, expect, it } from "vitest";
import { PHASE_ZERO_ORGANIZATION_SLUG } from "../src/repositories.js";

describe("database policy", () => {
  it("uses a named synthetic organization for Phase 0", () => {
    expect(PHASE_ZERO_ORGANIZATION_SLUG).toBe("rizpoint-demo");
  });
});
