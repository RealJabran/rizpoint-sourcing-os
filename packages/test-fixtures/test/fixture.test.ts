import { describe, expect, it } from "vitest";
import { mockScannerResult } from "../src/index.js";

describe("synthetic fixture", () => {
  it("contains no supplier data", () => {
    expect(mockScannerResult.row_count).toBe(3);
  });
});
