import { describe, expect, it } from "vitest";
import {
  analysisQuerySchema,
  analysisViewStateSchema,
  overrideSchema,
} from "../src/analysis/contracts.js";

describe("analysis workspace contracts", () => {
  it("bounds windowed queries and rejects unapproved sorting", () => {
    expect(
      analysisQuerySchema.safeParse({
        offset: "0",
        limit: "200",
        sort: "roiPercent",
      }).success,
    ).toBe(true);
    expect(analysisQuerySchema.safeParse({ limit: "201" }).success).toBe(false);
    expect(analysisQuerySchema.safeParse({ sort: "evidence" }).success).toBe(
      false,
    );
    expect(
      analysisQuerySchema.safeParse({ maxRoiPercent: "-0.01" }).success,
    ).toBe(true);
    expect(
      analysisQuerySchema.safeParse({
        featuredOfferState: "PRESENT",
        amazonRetailPresence: "UNKNOWN",
        pricingCompleteness: "PARTIAL",
        minFbaOfferCount: "1",
        maxFbmOfferCount: "4",
      }).success,
    ).toBe(true);
    expect(
      analysisQuerySchema.safeParse({ minFbaOfferCount: "-1" }).success,
    ).toBe(false);
  });

  it("keeps saved views versioned and financial edits Decimal-only", () => {
    expect(
      analysisViewStateSchema.safeParse({
        schemaVersion: 1,
        sort: "sourceRowNumber",
        direction: "asc",
        visibleGroups: ["identity"],
      }).success,
    ).toBe(true);
    expect(
      overrideSchema.safeParse({
        expectedRevision: 0,
        idempotencyKey: "3a9e1fd1-59f1-4d51-8cfe-9b2f36dfd614",
        reason: "Correct supplier invoice",
        values: [{ field: "SUPPLIER_COST_PER_SELLABLE_UNIT", value: "1.25" }],
        stressDiscountPercent: "10",
      }).success,
    ).toBe(true);
    expect(
      overrideSchema.safeParse({
        expectedRevision: 0,
        idempotencyKey: "3a9e1fd1-59f1-4d51-8cfe-9b2f36dfd614",
        reason: "Correct supplier invoice",
        values: [{ field: "SUPPLIER_COST_PER_SELLABLE_UNIT", value: "-0.01" }],
      }).success,
    ).toBe(false);
    expect(
      overrideSchema.safeParse({
        expectedRevision: 3,
        idempotencyKey: "3a9e1fd1-59f1-4d51-8cfe-9b2f36dfd614",
        reason: "Correct stress assumption",
        values: [],
        stressDiscountPercent: "8",
      }).success,
    ).toBe(true);
    expect(
      overrideSchema.safeParse({
        expectedRevision: 3,
        idempotencyKey: "3a9e1fd1-59f1-4d51-8cfe-9b2f36dfd614",
        reason: "No changes",
        values: [],
      }).success,
    ).toBe(false);
  });
});
