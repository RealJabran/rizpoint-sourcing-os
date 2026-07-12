import { describe, expect, it } from "vitest";
import { money } from "@rizpoint/domain";
import { assertCalculationAllowed } from "../src/index.js";

describe("profit calculation boundary", () => {
  it("blocks an uncertain pack", () => {
    expect(() =>
      assertCalculationAllowed({
        packGuardStatus: "BLOCKED_PACK_UNCERTAIN",
        modeledSellingPrice: money("10.00"),
      }),
    ).toThrow("pack relationship");
  });
});
