import { describe, expect, it } from "vitest";
import { PHASE_ZERO_ORGANIZATION_SLUG } from "../src/repositories.js";
import {
  ProductRecommendation,
  ProfitCalculationStatus,
} from "../src/index.js";

describe("database policy", () => {
  it("uses a named synthetic organization for Phase 0", () => {
    expect(PHASE_ZERO_ORGANIZATION_SLUG).toBe("rizpoint-demo");
  });

  it("exposes Phase 4 result states through the generated NUMERIC-backed schema", () => {
    expect(ProfitCalculationStatus.COMPLETED).toBe("COMPLETED");
    expect(ProductRecommendation.BUY).toBe("BUY");
  });
});
