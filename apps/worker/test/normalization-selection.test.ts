import { describe, expect, it } from "vitest";
import { selectMappedUploadSheet } from "../src/normalization-selection.js";

describe("normalization sheet selection", () => {
  it("selects one explicitly mapped sheet", () => {
    expect(
      selectMappedUploadSheet([
        { id: "one", sheetIndex: 0, selectedHeaderRow: null },
        { id: "two", sheetIndex: 1, selectedHeaderRow: 3 },
      ]),
    ).toMatchObject({ id: "two", selectedHeaderRow: 3 });
  });

  it("rejects ambiguous or missing sheet selections", () => {
    expect(
      selectMappedUploadSheet([
        { id: "one", sheetIndex: 0, selectedHeaderRow: 1 },
        { id: "two", sheetIndex: 1, selectedHeaderRow: 3 },
      ]),
    ).toBeNull();
    expect(
      selectMappedUploadSheet([
        { id: "one", sheetIndex: 0, selectedHeaderRow: null },
      ]),
    ).toBeNull();
  });
});
