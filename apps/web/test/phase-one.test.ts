import { describe, expect, it } from "vitest";
import {
  maxUploadBytes,
  profileInputSchema,
  validateUploadedObjectMetadata,
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

  it("rejects oversized or content-type-mismatched stored objects", () => {
    expect(() =>
      validateUploadedObjectMetadata(
        maxUploadBytes + 1,
        "text/csv",
        "text/csv",
      ),
    ).toThrow("FILE_SIZE_LIMIT");
    expect(() =>
      validateUploadedObjectMetadata(
        12,
        "application/octet-stream",
        "text/csv",
      ),
    ).toThrow("CONTENT_TYPE_MISMATCH");
  });

  it("requires saved profiles to use the same typed mapping rules", () => {
    expect(
      profileInputSchema.safeParse({
        name: "VSI",
        headerRow: 1,
        mapping: [
          {
            sourceIndex: 0,
            sourceColumn: "UPC",
            target: "UPC",
            required: true,
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      profileInputSchema.safeParse({
        name: "VSI",
        headerRow: 1,
        mapping: [
          {
            sourceIndex: 0,
            sourceColumn: "UPC",
            target: "NOT_A_TARGET",
            required: true,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("accepts MPN as a matching field", () => {
    expect(() =>
      validateMappings([
        { sourceIndex: 0, target: "MPN" },
        { sourceIndex: 1, target: "DESCRIPTION" },
      ]),
    ).not.toThrow();
    expect(
      profileInputSchema.safeParse({
        name: "VSI MPN",
        headerRow: 1,
        mapping: [
          {
            sourceIndex: 0,
            sourceColumn: "MPN",
            target: "MPN",
            required: true,
          },
          {
            sourceIndex: 1,
            sourceColumn: "Description",
            target: "DESCRIPTION",
            required: true,
          },
        ],
      }).success,
    ).toBe(true);
  });
});
