import { describe, expect, it } from "vitest";
import {
  maxUploadBytes,
  validateFilename,
  validateMappings,
} from "../src/phase-one.js";

describe("Phase 1 upload validation", () => {
  it("accepts supported filenames and enforces the size limit through the exported policy", () => {
    expect(() => validateFilename("VSI catalogue.XLSX")).not.toThrow();
    expect(maxUploadBytes).toBe(52_428_800);
  });

  it("rejects unsafe and unsupported filenames", () => {
    expect(() => validateFilename("../supplier.csv")).toThrow(
      "UNSAFE_FILENAME",
    );
    expect(() => validateFilename("supplier.exe")).toThrow(
      "UNSUPPORTED_FILE_TYPE",
    );
  });

  it("requires a description and one matching identifier without duplicates", () => {
    expect(() =>
      validateMappings([
        { sourceIndex: 0, target: "UPC" },
        { sourceIndex: 1, target: "DESCRIPTION" },
      ]),
    ).not.toThrow();
    expect(() => validateMappings([{ sourceIndex: 0, target: "UPC" }])).toThrow(
      "DESCRIPTION_REQUIRED",
    );
    expect(() =>
      validateMappings([
        { sourceIndex: 0, target: "UPC" },
        { sourceIndex: 0, target: "DESCRIPTION" },
      ]),
    ).toThrow("DUPLICATE_MAPPING");
  });
});
