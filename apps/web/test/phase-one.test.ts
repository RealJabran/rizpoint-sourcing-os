import { describe, expect, it } from "vitest";
import {
  maxUploadBytes,
  profileInputSchema,
  safeDisplayFilename,
  mappingSafetyIssues,
  inspectionRecoveryState,
  suggestMapping,
  uploadErrorMessage,
  validateDeclaredMediaType,
  validateUploadedObjectMetadata,
  validateFilename,
  validateMappings,
} from "../src/phase-one.js";
import { matchReviewInputSchema } from "../src/match-review.js";

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
    expect(() => validateFilename("supplier\n.csv")).toThrow("UNSAFE_FILENAME");
  });

  it("allows only compatible declared media types and maps upload errors safely", () => {
    expect(() =>
      validateDeclaredMediaType("supplier.csv", "text/csv"),
    ).not.toThrow();
    expect(() =>
      validateDeclaredMediaType("supplier.xlsx", "application/pdf"),
    ).toThrow("UNSUPPORTED_MEDIA_TYPE");
    expect(uploadErrorMessage("MALWARE_SCANNER_UNAVAILABLE")).toMatch(
      /temporarily unavailable/i,
    );
    expect(safeDisplayFilename("supplier\n.csv")).toBe("supplier�.csv");
    expect(uploadErrorMessage("SCANNER_REQUEST_FAILED")).toMatch(/retry/i);
  });

  it("keeps transient inspection failures visible and distinguishes retry paths", () => {
    expect(
      inspectionRecoveryState(
        "INSPECTING",
        "FAILED_RETRYABLE",
        "SCANNER_REQUEST_FAILED",
      ),
    ).toBe("AUTOMATIC_RETRY");
    expect(
      inspectionRecoveryState(
        "INSPECTING",
        "FAILED_FINAL",
        "SCANNER_REQUEST_FAILED",
      ),
    ).toBe("MANUAL_RETRY");
    expect(
      inspectionRecoveryState("REJECTED", "FAILED_FINAL", "INVALID_XLSX"),
    ).toBe("TERMINAL");
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

  it("requires a selected candidate, reason, and idempotency key to accept a match review", () => {
    expect(
      matchReviewInputSchema.safeParse({
        status: "USER_ACCEPTED",
        selectedCandidateId: null,
        reason: "Reviewed product details",
        idempotencyKey: "3a9e1fd1-59f1-4d51-8cfe-9b2f36dfd614",
      }).success,
    ).toBe(false);
    expect(
      matchReviewInputSchema.safeParse({
        status: "USER_ACCEPTED",
        selectedCandidateId: "candidate_123",
        reason: "Reviewed product details",
        idempotencyKey: "3a9e1fd1-59f1-4d51-8cfe-9b2f36dfd614",
      }).success,
    ).toBe(true);
    expect(
      matchReviewInputSchema.safeParse({
        status: "USER_ACCEPTED",
        selectedCandidateId: "candidate_123",
      }).success,
    ).toBe(false);
  });

  it("suggests mappings but blocks contradictory case and pack samples", () => {
    expect(suggestMapping("Supplier UPC")).toMatchObject({ target: "UPC" });
    expect(suggestMapping("EAN")).toMatchObject({ target: "EAN" });
    expect(suggestMapping("GTIN")).toMatchObject({ target: "GTIN" });
    expect(suggestMapping("Wholesale Price")).toMatchObject({
      target: "UNIT_COST",
    });
    expect(
      mappingSafetyIssues(
        { 0: "DESCRIPTION", 1: "UPC", 2: "CASE_COUNT", 3: "PACK_COUNT" },
        [["Pet treats", "012345678905", "10", "6"]],
      ),
    ).toContainEqual(expect.stringMatching(/whole sellable units/i));
  });
});
